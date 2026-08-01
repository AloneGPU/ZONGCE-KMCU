#!/usr/bin/env python3
"""
昆明城市学院教务系统成绩爬虫 V2
直接通过 URL 参数查询各学期成绩
"""

import sys
import json
import argparse
import asyncio
from playwright.async_api import async_playwright

BASE_URL = "http://jw.kmcc.edu.cn/ynsfdxsxy_jsxsd"

# 已知的学期列表（从下拉框中获取）
ALL_SEMESTERS = [
    "2026-2027-1", "2025-2026-2", "2025-2026-1",
    "2024-2025-2", "2024-2025-1", "2023-2024-2", "2023-2024-1",
    "2022-2023-2", "2022-2023-1", "2021-2022-2", "2021-2022-1",
    "2020-2021-2", "2020-2021-1", "2019-2020-2", "2019-2020-1",
    "2018-2019-2", "2018-2019-1", "2017-2018-2", "2017-2018-1",
    "2016-2017-2", "2016-2017-1", "2015-2016-2", "2015-2016-1",
    "2014-2015-2", "2014-2015-1", "2013-2014-2", "2013-2014-1",
    "2012-2013-2", "2012-2013-1",
]


def semester_to_year(sem):
    parts = sem.split("-")
    if len(parts) >= 2:
        return f"{parts[0]}-{parts[1]}"
    return sem


async def scrape_grades(username, password, target_year=None):
    results = {
        "success": False,
        "studentName": "",
        "studentCode": username,
        "semesters": {}
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            viewport={"width": 1280, "height": 800},
            locale="zh-CN"
        )
        page = await context.new_page()

        try:
            # ========== Step 1: 登录 ==========
            await page.goto(f"{BASE_URL}/", wait_until="networkidle", timeout=30000)
            await page.fill("#userAccount", username)
            await page.fill("#userPassword", password)
            await page.click("#btnSubmit")
            await page.wait_for_timeout(3000)

            # 检查登录失败
            content = await page.content()
            if "用户名或密码错误" in content:
                results["error"] = "用户名或密码错误"
                return results

            # 等待跳转
            try:
                await page.wait_for_url("**/xsMain.jsp**", timeout=15000)
            except:
                # 可能已经在主页
                pass

            # 提取姓名
            try:
                top_text = await page.text_content("body")
                # 尝试匹配 "姓名(学号)" 格式
                for line in top_text.split("\n"):
                    line = line.strip()
                    if f"({username})" in line:
                        results["studentName"] = line.split("(")[0].strip()
                        break
                if not results["studentName"]:
                    # 尝试匹配 "姓名：朱林涛" 格式
                    for line in top_text.split("\n"):
                        if "姓名：" in line:
                            results["studentName"] = line.split("姓名：")[1].split(" ")[0].split("学号")[0].strip()
                            break
            except:
                pass

            # ========== Step 2: 确定要查询的学期 ==========
            if target_year:
                target_semesters = [s for s in ALL_SEMESTERS if s.startswith(target_year)]
            else:
                target_semesters = ALL_SEMESTERS[:8]  # 最近8个学期(4学年)

            all_courses = []
            seen_courses = set()

            # ========== Step 3: 逐个学期查询 ==========
            for sem_name in target_semesters:
                # 访问成绩查询页
                await page.goto(
                    f"{BASE_URL}/kscj/cjcx_query?Ves632DSdyV=NEW_XSD_XJCJ",
                    wait_until="domcontentloaded", timeout=8000
                )

                # 查找学期下拉框并选择学期
                try:
                    # 找到 <select> 元素（有多种可能的选择器）
                    select_el = await page.query_selector('select:has(option[value])')
                    if not select_el:
                        select_el = await page.query_selector('select')
                    if select_el:
                        await select_el.select_option(label=sem_name)
                    else:
                        continue
                except Exception as e:
                    continue

                # 点击查询按钮
                try:
                    # 找"查询"按钮
                    query_btn = await page.query_selector('input[value="查 询"]')
                    if not query_btn:
                        query_btn = await page.query_selector('button:has-text("查询")')
                    if not query_btn:
                        query_btn = await page.query_selector('input[type="submit"]')
                    if query_btn:
                        await query_btn.click()
                    else:
                        continue
                except:
                    continue

                await page.wait_for_timeout(1200)

                # 切换到结果页（可能开了新窗口）
                pages = context.pages
                grade_page = None
                for p in pages:
                    if "cjcx" in p.url and "query" not in p.url:
                        grade_page = p
                        break

                if not grade_page:
                    # 检查当前页是否已有成绩表
                    grade_page = page

                if grade_page != page:
                    await grade_page.bring_to_front()

                # 提取成绩表
                rows = await grade_page.evaluate("""
                    () => {
                        const tables = document.querySelectorAll('table');
                        for (const table of tables) {
                            const firstCell = table.querySelector('tr:first-child td:first-child, tr:first-child th:first-child');
                            if (firstCell && firstCell.textContent.trim() === '序号') {
                                return Array.from(table.querySelectorAll('tr')).slice(1).map(tr => {
                                    const tds = tr.querySelectorAll('td');
                                    if (tds.length < 5) return null;
                                    return Array.from(tds).map(td => td.textContent.trim());
                                }).filter(Boolean);
                            }
                        }
                        return [];
                    }
                """)

                for row in rows:
                    if len(row) < 5:
                        continue
                    course_code = row[2] if len(row) > 2 else ""
                    score_str = row[4] if len(row) > 4 else ""
                    key = f"{course_code}:{sem_name}"
                    if key in seen_courses:
                        continue
                    seen_courses.add(key)

                    try:
                        score = float(score_str)
                    except ValueError:
                        continue

                    all_courses.append({
                        "semester": sem_name,
                        "courseCode": course_code,
                        "courseName": row[3] if len(row) > 3 else "",
                        "score": score,
                        "credit": float(row[6]) if len(row) > 6 and row[6] else 0,
                        "gpa": row[8] if len(row) > 8 else "",
                        "examType": row[9] if len(row) > 9 else "",
                        "courseAttr": row[10] if len(row) > 10 else "",
                        "courseType": row[11] if len(row) > 11 else "",
                    })

            # ========== Step 4: 分组计算 ==========
            year_groups = {}
            for course in all_courses:
                year = semester_to_year(course["semester"])
                if year not in year_groups:
                    year_groups[year] = {
                "courses": [],
                "courseCount": 0,
                "weightedAvg": 0,
                "requiredCredits": 0,
                "requiredScoreCredits": 0,
                "allCredits": 0,
                "allScoreCredits": 0,
                "allAvg": 0,
            }
                year_groups[year]["courses"].append(course)
                year_groups[year]["courseCount"] += 1

            for year, group in year_groups.items():
                required_credit = 0.0
                required_score_credit = 0.0
                all_credit = 0.0
                all_score_credit = 0.0
                for c in group["courses"]:
                    all_credit += c["credit"]
                    all_score_credit += c["score"] * c["credit"]
                    if c["courseAttr"] == "必修":
                        required_score_credit += c["score"] * c["credit"]
                        required_credit += c["credit"]

                group["requiredCredits"] = round(required_credit, 1)
                group["requiredScoreCredits"] = round(required_score_credit, 1)
                group["weightedAvg"] = round(
                    required_score_credit / required_credit, 2
                ) if required_credit > 0 else 0
                group["allCredits"] = round(all_credit, 1)
                group["allScoreCredits"] = round(all_score_credit, 1)
                group["allAvg"] = round(
                    all_score_credit / all_credit, 2
                ) if all_credit > 0 else 0

            results["success"] = True
            results["totalCourses"] = len(all_courses)
            results["semesters"] = year_groups

        except Exception as e:
            results["error"] = str(e)
        finally:
            await browser.close()

    return results


def main():
    parser = argparse.ArgumentParser(description="教务系统成绩爬虫 V2")
    parser.add_argument("username", help="学号")
    parser.add_argument("--year", "-y", help="指定学年，如 2025-2026")
    parser.add_argument("--pretty", action="store_true", help="格式化输出")
    args = parser.parse_args()

    # 密码从 stdin 读取（避免 ps aux 暴露）
    password = sys.stdin.read().strip()

    result = asyncio.run(scrape_grades(args.username, password, args.year))
    indent = 2 if args.pretty else None
    print(json.dumps(result, ensure_ascii=False, indent=indent))
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
