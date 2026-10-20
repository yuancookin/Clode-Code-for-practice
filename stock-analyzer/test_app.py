from streamlit.testing.v1 import AppTest


def test_app_demo_runs_without_errors():
    at = AppTest.from_file("app.py", default_timeout=120).run()
    at.button(key="run_demo").click().run()
    assert not at.exception
    table = at.dataframe[0].value
    assert "買い注文を出す" in set(table["判定"]) and table["逆指値（買い）"].str.endswith("円").any()


def test_app_reports_unreadable_input():
    at = AppTest.from_file("app.py", default_timeout=120).run()
    at.text_area[0].input("https://example.com/foo").run()
    at.button(key="run_code").click().run()
    assert not at.exception
    assert any("読み取れなかった" in w.value for w in at.warning)
