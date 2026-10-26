import common
import screen


def test_screen_with_demo_prices(monkeypatch, tmp_path):
    monkeypatch.setattr(screen, "fetch_prices", lambda t, period: common.demo_prices(t))
    monkeypatch.setattr(screen.time, "sleep", lambda s: None)
    out = tmp_path / "screen.md"
    names = list(common.DEMO_SCENARIOS)
    assert screen.main([*names, "--out", str(out)]) == 0
    text = out.read_text(encoding="utf-8")
    assert "## 候補一覧" in text and "DEMO-上抜け直前" in text and "逆指値（買い）" in text
    assert "DEMO-下落中 |" not in text  # 対象外は一覧に載せない
