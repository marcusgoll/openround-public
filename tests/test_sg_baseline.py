import json
from pathlib import Path

import pytest

from openround import db, sg
from openround.__main__ import main
from openround.shotmap import build_html

FIXTURE = Path(__file__).parent / 'fixtures' / 'synthetic-sg.json'


def test_unconfigured_is_explicit(monkeypatch, con, tmp_path, capsys, fixture_round):
    monkeypatch.delenv('OPENROUND_SG_BASELINE', raising=False)
    with pytest.raises(sg.BaselineUnavailable, match='OPENROUND_SG_BASELINE'):
        sg.expected_strokes(100, 'tee')
    assert main(['--db', str(tmp_path / 'cli.db'), 'stats']) == 0
    assert main(['--db', str(tmp_path / 'cli.db'), 'sg']) == 1
    assert 'SG unavailable' in capsys.readouterr().err
    rid = db.upsert_round(con, fixture_round)
    with pytest.raises(sg.BaselineUnavailable):
        sg.round_shot_sg(con, rid)
    html = build_html(con, tmp_path)
    assert 'SG unavailable' in html
    assert 'PGA Tour' not in html
    assert 'SG n/a' in html
    assert '<div class="tval">n/a</div>' in html
    assert 'class="sh unavailable' in html or 'unavailable rd' in html


def test_valid_baseline(monkeypatch):
    monkeypatch.setenv('OPENROUND_SG_BASELINE', str(FIXTURE))
    assert sg.load_baseline()['name'] == 'Synthetic arithmetic fixture; not calibrated'
    assert sg.expected_strokes(400 * sg.M_PER_YD, 'tee') == 6


@pytest.mark.parametrize('mutation', [
    lambda d: d.update(name=''),
    lambda d: d['off_green_yd'].pop('sand'),
    lambda d: d.update(putting_ft=[]),
    lambda d: d.update(putting_ft=[[2, 1], [1, 2]]),
    lambda d: d.update(putting_ft=[[1, 1], [1, 2]]),
    lambda d: d.update(putting_ft=[[1, -1]]),
    lambda d: d.update(putting_ft=[[float('nan'), 1]]),
    lambda d: d.update(putting_ft=[[1, float('inf')]]),
    lambda d: d.update(putting_ft=[[True, 1]]),
    lambda d: d.update(putting_ft=[[-1, 1]]),
    lambda d: d.update(putting_ft=[[1, 2, 3]]),
])
def test_invalid_baseline(monkeypatch, tmp_path, mutation):
    data = json.loads(FIXTURE.read_text())
    mutation(data)
    path = tmp_path / 'bad.json'
    path.write_text(json.dumps(data))
    monkeypatch.setenv('OPENROUND_SG_BASELINE', str(path))
    with pytest.raises(sg.BaselineUnavailable):
        sg.load_baseline()


@pytest.mark.parametrize('contents', ['{', 'null', '[]'])
def test_malformed_baseline(monkeypatch, tmp_path, contents):
    path = tmp_path / 'bad.json'
    path.write_text(contents)
    monkeypatch.setenv('OPENROUND_SG_BASELINE', str(path))
    with pytest.raises(sg.BaselineUnavailable):
        sg.load_baseline()


def test_missing_file(monkeypatch, tmp_path):
    monkeypatch.setenv('OPENROUND_SG_BASELINE', str(tmp_path / 'missing.json'))
    with pytest.raises(sg.BaselineUnavailable):
        sg.load_baseline()
