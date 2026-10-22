import backtest_report
import common


def test_report_with_demo_prices(monkeypatch, tmp_path):
    # ネットに出ずに、疑似データで最後まで動くことを確かめる
    monkeypatch.setattr(backtest_report, "fetch_prices", lambda t, period: common.demo_prices(t))
    monkeypatch.setattr(backtest_report.time, "sleep", lambda s: None)
    out = tmp_path / "report.md"
    names = ["DEMO-1回目の波", "DEMO-2回目の波", "DEMO-下落中"]
    assert backtest_report.main([*names, "--out", str(out), "--csv", str(tmp_path / "t.csv")]) == 0
    text = out.read_text(encoding="utf-8")
    assert "## 銘柄別" in text and all(n in text for n in names)


def test_failed_ticker_is_listed(monkeypatch, capsys):
    def fetch(t, period):
        if t == "BAD":
            raise RuntimeError("取得失敗")
        return common.demo_prices(t)
    monkeypatch.setattr(backtest_report, "fetch_prices", fetch)
    monkeypatch.setattr(backtest_report.time, "sleep", lambda s: None)
    assert backtest_report.main(["DEMO-1回目の波", "BAD"]) == 0
    assert "取得できなかった銘柄" in capsys.readouterr().out
