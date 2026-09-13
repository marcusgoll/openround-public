from openround import db, shotmap


def test_build_html_smoke(con, fixture_round, tmp_path):
    db.upsert_round(con, fixture_round)
    html = shotmap.build_html(con, tmp_path)  # no OSM cache dir: blank ground
    assert "<title>OpenRound Shot Atlas</title>" in html
    assert 'class="shg' in html or 'circle class="sh' in html   # at least one mark
    assert "no OSM geometry cached" in html
    assert html.count('data-theme="dark"') >= 1                 # theme toggle scope present
    out = shotmap.write_shotmap(con, tmp_path, tmp_path / "m.html")
    assert out.exists() and out.stat().st_size > 5000
    assert out.read_text(encoding="utf-8") == html


def test_bins():
    assert shotmap._bin(-2.0) == "b0"
    assert shotmap._bin(-0.4) == "b1"
    assert shotmap._bin(0.0) == "b2"
    assert shotmap._bin(0.5) == "b3"
    assert shotmap._bin(1.4) == "b4"


def test_hole_zoom_data_present(con, fixture_round, tmp_path):
    db.upsert_round(con, fixture_round)
    html = shotmap.build_html(con, tmp_path)
    assert 'class="holedata"' in html
    assert 'data-h="1"' in html                  # a hole chip
    assert '"vb":' in html and '"cap":' in html  # zoom boxes + captions
    assert "Full course" in html
