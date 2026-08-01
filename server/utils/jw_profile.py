#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
教务系统学生信息爬虫 — 从学籍卡片页面提取院系、专业、班级、年级
密码从 stdin 读取
"""
import sys, json, re, asyncio
from playwright.async_api import async_playwright

BASE_URL = "http://jw.kmcc.edu.cn/ynsfdxsxy_jsxsd"
TAB = chr(9)
NL = chr(10)


def extract_by_line(text, field_name):
    """
    从 院系：X[TAB]专业：Y[TAB]班级：Z 这样的单行中按字段名提取值
    """
    for line in text.split(NL):
        if field_name in line:
            parts = line.split(TAB)
            for part in parts:
                part = part.strip()
                for prefix in [field_name + chr(0xFF1A), field_name + ":"]:
                    if part.startswith(prefix):
                        return part[len(prefix):].strip()
    return ""


def extract_field(text, field_name):
    """从文本中提取 字段名：值（值以 tab 或换行结束）"""
    idx = text.find(field_name)
    if idx < 0:
        return ""
    start = idx + len(field_name)
    if start < len(text) and text[start] in (chr(0xFF1A), ":"):
        start += 1
    while start < len(text) and text[start] in (" ", TAB, chr(0xA0)):
        start += 1
    end = start
    while end < len(text) and text[end] not in (TAB, NL, chr(13)):
        end += 1
    return text[start:end].strip()


async def scrape_profile(username):
    password = sys.stdin.read().strip()
    result = {
        "success": False,
        "studentName": "",
        "studentCode": username,
        "college": "",
        "major": "",
        "className": "",
        "grade": "",
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        try:
            # Step 1: 登录
            await page.goto(f"{BASE_URL}/", wait_until="networkidle", timeout=20000)
            await page.fill("#userAccount", username)
            await page.fill("#userPassword", password)
            await page.click("#btnSubmit")
            await page.wait_for_timeout(4000)

            content = await page.content()
            if "用户名或密码错误" in content:
                result["error"] = "用户名或密码错误"
                return result

            if "xsMain.jsp" not in page.url and "main.jsp" not in page.url:
                result["error"] = "登录失败，请重试"
                return result

            # Step 2: 访问学籍卡片页面
            await page.goto(f"{BASE_URL}/grxx/xsxx", wait_until="networkidle", timeout=15000)
            await page.wait_for_timeout(2000)

            text = await page.evaluate("document.body.innerText")

            # Step 3: 提取字段
            result["college"] = extract_by_line(text, "院系")
            result["major"] = extract_by_line(text, "专业")
            result["className"] = extract_by_line(text, "班级")
            result["studentName"] = extract_field(text, "姓名")

            # 入学日期 -> 年级
            enroll = extract_field(text, "入学日期")
            if enroll and len(enroll) >= 4:
                year_part = enroll[:4]
                if year_part.isdigit():
                    result["grade"] = year_part + "级"

            # 兜底：从班级名推断（"24物联网工程1班" -> "2024级"）
            if not result["grade"] and result["className"]:
                m = re.match(r"(\d{2})", result["className"])
                if m:
                    n = int(m.group(1))
                    result["grade"] = str(2000 + n) + "级"

            result["success"] = True

        except Exception as e:
            result["error"] = str(e)
        finally:
            await browser.close()

    return result


if __name__ == "__main__":
    r = asyncio.run(scrape_profile(sys.argv[1]))
    print(json.dumps(r, ensure_ascii=False))
    sys.exit(0 if r["success"] else 1)
