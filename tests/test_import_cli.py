import json

from openround import db
from openround.__main__ import main


def _write_round(path, fixture_round, **changes):
    rnd = dict(fixture_round, **changes)
    path.write_text(json.dumps(rnd))


def test_imports_all_files_as_one_batch_before_success_output(
    tmp_path, fixture_round, capsys
):
    first = tmp_path / "first.json"
    second = tmp_path / "second.json"
    _write_round(first, fixture_round, source_id="r1")
    _write_round(second, fixture_round, source_id="r2")

    rc = main(["--db", str(tmp_path / "rounds.db"), "import", str(first), str(second)])

    captured = capsys.readouterr()
    assert rc == 0
    assert "imported first.json" in captured.out
    assert "imported second.json" in captured.out
    assert "2 round(s) imported" in captured.out
    con = db.connect(tmp_path / "rounds.db")
    assert con.execute("SELECT COUNT(*) FROM rounds").fetchone()[0] == 2


def test_malformed_later_file_has_no_success_output_or_rows(
    tmp_path, fixture_round, capsys
):
    valid = tmp_path / "valid.json"
    malformed = tmp_path / "malformed.json"
    _write_round(valid, fixture_round)
    malformed.write_text("{not json")
    db_path = tmp_path / "rounds.db"

    rc = main(["--db", str(db_path), "import", str(valid), str(malformed)])

    captured = capsys.readouterr()
    assert rc == 1
    assert captured.out == ""
    assert captured.err.startswith("import failed:")
    con = db.connect(db_path)
    assert con.execute("SELECT COUNT(*) FROM rounds").fetchone()[0] == 0


def test_invalid_data_has_no_success_output_or_rows(tmp_path, fixture_round, capsys):
    valid = tmp_path / "valid.json"
    invalid = tmp_path / "invalid.json"
    _write_round(valid, fixture_round)
    _write_round(invalid, fixture_round, source_id="bad", holes=[{"number": 0, "shots": []}])
    db_path = tmp_path / "rounds.db"

    rc = main(["--db", str(db_path), "import", str(valid), str(invalid)])

    captured = capsys.readouterr()
    assert rc == 1
    assert captured.out == ""
    assert captured.err.startswith("import failed:")
    con = db.connect(db_path)
    assert con.execute("SELECT COUNT(*) FROM rounds").fetchone()[0] == 0


def test_invalid_utf8_has_no_success_output_or_rows(tmp_path, capsys):
    invalid = tmp_path / "invalid.json"
    invalid.write_bytes(b"\x80\x81")
    db_path = tmp_path / "rounds.db"

    rc = main(["--db", str(db_path), "import", str(invalid)])

    captured = capsys.readouterr()
    assert rc == 1
    assert captured.out == ""
    assert captured.err.startswith("import failed:")
    con = db.connect(db_path)
    assert con.execute("SELECT COUNT(*) FROM rounds").fetchone()[0] == 0


def test_repeated_cli_import_reuses_round_and_evidence(tmp_path, fixture_round, capsys):
    path = tmp_path / "round.json"
    db_path = tmp_path / "rounds.db"
    _write_round(path, fixture_round)

    assert main(["--db", str(db_path), "import", str(path)]) == 0
    capsys.readouterr()
    con = db.connect(db_path)
    before = [tuple(row) for row in con.execute(
        "SELECT id, canonical_json, canonical_sha256 FROM shot_evidence ORDER BY id"
    )]
    assert before

    assert main(["--db", str(db_path), "import", str(path)]) == 0
    captured = capsys.readouterr()
    after = [tuple(row) for row in con.execute(
        "SELECT id, canonical_json, canonical_sha256 FROM shot_evidence ORDER BY id"
    )]
    assert "1 round(s) imported" in captured.out
    assert con.execute("SELECT COUNT(*) FROM rounds").fetchone()[0] == 1
    assert after == before
