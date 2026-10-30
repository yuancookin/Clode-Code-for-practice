from streamlit.testing.v1 import AppTest


def test_app_demo_runs_without_errors():
    at = AppTest.from_file("page_buy.py", default_timeout=120).run()
    at.button(key="run_demo").click().run()
    assert not at.exception
    table = at.dataframe[0].value
    assert "買い注文を出す" in set(table["判定"]) and table["逆指値（買い）"].str.endswith("円").any()


def test_app_reports_unreadable_input():
    at = AppTest.from_file("page_buy.py", default_timeout=120).run()
    at.text_area[0].input("https://example.com/foo").run()
    at.button(key="run_code").click().run()
    assert not at.exception
    assert any("読み取れなかった" in w.value for w in at.warning)


def test_position_page_demo_runs_without_errors():
    at = AppTest.from_file("page_position.py", default_timeout=120).run()
    at.button(key="run_demo").click().run()
    assert not at.exception
    table = at.dataframe[1].value  # 0 は入力用の表
    assert set(table["判定"]) == {"保有継続", "利益確定", "ロスカット"}


def test_router_opens_buy_page():
    at = AppTest.from_file("app.py", default_timeout=120).run()
    assert not at.exception and at.title[0].value == "📈 買いの判定"
