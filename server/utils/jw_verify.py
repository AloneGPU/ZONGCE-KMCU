#!/usr/bin/env python3
"""教务系统身份验证（从 stdin 读取密码，避免 ps aux 泄露）"""
import sys, json, asyncio
from playwright.async_api import async_playwright

async def verify(username):
    password = sys.stdin.read().strip()
    result = {"success": False, "studentName": ""}
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        try:
            await page.goto("http://jw.kmcc.edu.cn/ynsfdxsxy_jsxsd/", wait_until="networkidle", timeout=20000)
            await page.fill("#userAccount", username)
            await page.fill("#userPassword", password)
            await page.click("#btnSubmit")
            await page.wait_for_timeout(3000)
            content = await page.content()
            if "用户名或密码错误" in content:
                result["error"] = "用户名或密码错误"
            elif "xsMain.jsp" in page.url or "学生个人中心" in await page.title():
                result["success"] = True
                try:
                    name_el = await page.query_selector("text=" + username)
                    if name_el:
                        text = await name_el.text_content()
                        result["studentName"] = text.split("(")[0].strip()
                except: pass
            else:
                result["error"] = "验证失败，请重试"
        except Exception as e:
            result["error"] = str(e)
        finally:
            await browser.close()
    return result

if __name__ == "__main__":
    r = asyncio.run(verify(sys.argv[1]))
    print(json.dumps(r, ensure_ascii=False))
    sys.exit(0 if r["success"] else 1)
