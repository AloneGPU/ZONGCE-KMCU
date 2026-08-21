# 大学生综合素质测评管理平台 — 技术说明文档

> 版本：V2.0 | 最后更新：2026-08-01 | 适用学院：数据科学与工程学院

---

## 一、项目概述

大学生综合素质测评管理平台是一个面向高校的全流程综测管理系统，覆盖**学生申报、班委初审、辅导员终审、成绩计算、排名导出**等完整业务链路。系统基于B/S架构，支持管理员、辅导员、班委、学生四种角色。

### 1.1 技术栈

| 分层 | 技术 | 说明 |
|------|------|------|
| 后端框架 | Node.js + Express 4.x | RESTful API |
| 数据库 | MySQL 8.0 | mysql2/promise 连接池 |
| 认证 | JWT (jsonwebtoken) | Bearer Token，token_version 撤销机制 |
| 前端（新版） | React 19 + TypeScript + Tailwind CSS + Recharts | 暗色主题，响应式布局 |
| 前端 | React 19 + TypeScript + Tailwind CSS + Recharts | 源码位于 `frontend/`，构建产物输出到 `public/` |
| Excel 导入 | XLSX/CSV 解析 + MySQL | 学生信息、教师信息、基础成绩批量导入 |
| 文件处理 | multer + magic number 校验 | 图片上传，10MB 限制 |
| 图片归档 | 文件夹存储 + MySQL 相对路径 | 支持外置 `UPLOAD_ROOT`、证明图片 ZIP 流式导出 |
| Excel 导出 | ExcelJS | 35 列标准登分表 |
| 进程管理 | PM2 | 生产环境守护进程 |
| 安全 | helmet + express-rate-limit + bcryptjs | 安全头、限流、密码哈希 |

### 1.2 项目结构

```
zongce/
├── server/                        # Express 后端
│   ├── app.js                     # 入口，挂载中间件和路由
│   ├── config/                    # auth.js(JWT)、database.js(连接池)、initDb.js、migrate.js
│   ├── controllers/               # 8 个控制器：auth、user、submission、scoring、export、scoreTable、notification、classRequest
│   ├── middleware/                 # auth.js(JWT验证+token_version)、role.js(角色权限)
│   ├── models/                    # 6 个数据模型：user、student、teacher、submission、score、scoringRule
│   ├── routes/                    # 路由文件：auth、admin、counselor、assistant、student、files、notifications
│   └── utils/                     # multer上传、魔数校验、审计日志等工具
├── frontend/                      # React 前端源码
│   ├── src/
│   │   ├── App.tsx                # 根组件：状态管理 + 路由 + 数据加载
│   │   ├── components/
│   │   │   ├── HeaderBar.tsx      # 顶栏：学年切换、通知铃铛、用户菜单
│   │   │   ├── LoginModal.tsx     # 登录/注册页：JWT 登录 + 本地注册 + 过渡动画
│   │   │   ├── Sidebar.tsx        # 侧边栏：角色自适应菜单
│   │   │   └── views/             # 11 个视图组件（见下文）
│   │   ├── services/api.ts        # API 客户端：fetch 封装 + XHR 上传进度
│   │   ├── utils/
│   │   │   └── excel.ts           # 前端 Excel 导出工具
│   │   └── types.ts               # TypeScript 类型定义
│   └── vite.config.ts             # Vite 构建配置（outDir → ../public）
├── public/                        # 前端生产产物（Express 静态托管）
│   ├── index.html                 # React 构建入口
│   ├── assets/                    # Vite 构建产物（含哈希）
│   └── uploads/                   # 默认上传目录；生产建议用 UPLOAD_ROOT 外置
├── database/
│   ├── schema/000_schema.sql      # 初始建库脚本
│   └── migrations/                # 增量迁移（按编号顺序）
└── docs/                          # 架构、部署、更新日志、学校原文
```

---

## 二、数据库设计

### 2.1 核心表

| 表名 | 用途 | 关键字段 |
|------|------|---------|
| `colleges` | 学院 | id, name, code |
| `academic_years` | 学年 | id, name, is_current |
| `class_options` | 登录注册/分班专业班级选项 | college_id, grade, major, class_name, is_active |
| `users` | 统一账号 | account, password_hash, role, email, token_version |
| `teachers` | 教师/辅导员 | user_id, employee_id, college_id |
| `teacher_classes` | 辅导员负责班级 | teacher_id, class_name（唯一约束） |
| `students` | 学生 | user_id, student_id(学号), class_name, college_id, counselor_name, is_assistant |
| `scoring_modules` | 六模块 | name, weight（共6行：德育20%/智育40%/体育10%/能力10%/美育10%/劳动10%） |
| `scoring_items` | 加分项 | module_id, name, max_score(固定分值), requires_proof, evidence(佐证材料) |
| `submissions` | 材料提交 | student_id, item_id, score, award_month, status, proof_path |
| `imported_scores` | 批量导入成绩 | student_id, module_id, item_id, score, source |
| `audit_logs` | 审计日志 | user_id, action, target_type, target_id |
| `announcements` | 系统公告 | title, content, visibility, target_user_id |
| `class_change_requests` | 班级变更申请 | teacher_id, action(add/remove), class_name, status(pending/approved/rejected) |
| `scrape_logs` | 历史自动对接日志 | student_code, success, courses, error_msg |
| `email_verification_codes` | 邮箱验证码 | email, purpose, code_hash, expires_at, consumed_at |
| `schema_migrations` | 迁移记录 | filename, applied_at |

### 2.2 级联关系

```
colleges ← students.college_id
colleges ← teachers.college_id
teachers ← teacher_classes.teacher_id
users ← students.user_id
users ← teachers.user_id
scoring_modules ← scoring_items.module_id
scoring_modules ← submissions.module_id
scoring_modules ← imported_scores.module_id
students ← submissions.student_id
students ← imported_scores.student_id
```

---

## 三、认证与鉴权

### 3.1 登录流程

```
login POST → /api/auth/login {account, password}
  ├─ 学生学号 → 本地 users 表 bcrypt 比对 → 返回 JWT + studentInfo
  ├─ 教师工号 → 本地 users 表 bcrypt 比对 → 返回 JWT + teacherInfo
  └─ 管理员账号 → 本地 users 表 bcrypt 比对 → 返回 JWT

remember password
  └─ 登录页勾选“记住密码”后，仅在登录成功时写入浏览器 localStorage；取消勾选会清除本机缓存

register POST → /api/auth/register
  ├─ 学生：填写学号、姓名、邮箱、邮箱验证码、密码、年级、专业、班级、辅导员姓名
  ├─ 辅导员：填写工号、姓名、邮箱、邮箱验证码、密码、管理年级，并从班级管理中多选负责班级
  ├─ 若管理员已导入该学生 → 校验姓名后绑定本地账号
  ├─ 若未导入该学生 → 创建 users + students 记录
  └─ 辅导员注册成功后自动创建/绑定 users、teachers、teacher_classes；负责班级必须来自管理员已维护的 class_options

send-code POST → /api/auth/send-code
  ├─ purpose=register → 给注册邮箱发送验证码
  └─ purpose=reset_password → 校验账号与邮箱匹配后发送验证码

reset-password POST → /api/auth/reset-password
  └─ 账号 + 邮箱 + 验证码 + 新密码 → 更新本地密码并使旧 token 失效
```

### 3.2 JWT 设计

```json
{
  "userId": 7,
  "role": "counselor",
  "name": "Alone",
  "v": 0,
  "iat": 1785408982,
  "exp": 1785495382
}
```

- `v` (token_version) 用于令牌撤销：修改密码或提升/降级班委时 `token_version + 1`，所有旧 token 立即失效
- 默认过期时间 24 小时

### 3.3 角色权限矩阵

| 资源 | admin | counselor | assistant | student |
|------|:-----:|:---------:|:---------:|:-------:|
| 数据总览 | ✅ | ✅（有班级筛选） | ✅ | ✅ |
| 学生/教师管理（查看） | ✅ | ✅ | - | - |
| 学生/教师管理（增删） | ✅ | - | - | - |
| 班委提升/降级 | ✅ | ✅ | - | - |
| 登录注册班级管理 | ✅ 增删改查，可选绑定辅导员 | - | - | - |
| 教师负责班级编辑 | ✅ 从数据库班级选择后直接保存 | ✅ 从数据库班级选择后提交申请 | - | - |
| 班级变更审批 | ✅ | - | - | - |
| 评分规则增删改 | ✅ | ✅ | - | - |
| 评分规则查看 | ✅ | ✅ | ✅ | ✅ |
| 材料审核 | - | ✅（终审） | ✅（初审） | - |
| 提交材料 | - | - | ✅ | ✅ |
| 删除材料 | ✅ 任意材料 | ✅ 仅负责班级 | - | 仅本人待审/驳回 |
| 成绩查看 | ✅ | ✅ | ✅ | ✅ |
| 成绩导出 | ✅ 全院/年级/班级/分板块 | ✅ 仅负责班级 | ✅（本班） | - |
| 证明图片 ZIP 导出 | ✅ | ✅（负责班级） | ✅（本班） | - |
| 图片一致性检查 | ✅ | - | - | - |
| 学年管理 | ✅ | - | - | - |
| 系统公告发布 | ✅ | ✅ | ✅ | - |

### 3.4 上线验收清单

建议首次部署后按以下顺序用 4 个测试账号走一遍：

1. 管理员先在“师生数据与班级名单管理 - 班级管理”维护年级、专业、班级；辅导员可以先不绑定，后续再绑定。
2. 管理员导入学生、导入教师，并为教师分配负责班级；新增学生/教师负责班级均只能从数据库已有班级中选择。
3. 管理员提升一名学生为班委，该学生重新登录后出现班委菜单。
4. 学生选择加分项、选择奖项获得月份、填写自定义图片名称、上传 JPG/PNG/GIF 证明图片；申请理由可保持默认“无”。
5. 班委查看本班待审材料并初审通过。
6. 辅导员查看负责班级材料并终审通过。
7. 管理员在导出中心执行“检查图片一致性”，确认无缺失后导出证明图片 ZIP。
8. 打开 ZIP，确认图片名为 `学号_姓名_类别_分值_自定义名称.后缀`。

---

## 四、综测计算引擎

### 4.1 六模块权重公式

```
总分 = 德育 × 0.2 + 智育 × 0.4 + 体育 × 0.1 + 能力 × 0.1 + 美育 × 0.1 + 劳动 × 0.1
```

### 4.2 各模块计算规则

| 模块 | 基础分 | 得分来源 |
|------|--------|---------|
| 德育 | 60 | + 加分项合计（含减分项的负分），低于 60 不得评优 |
| 智育 | 学业加权平均分 | 由管理员/辅导员通过 Excel 导入到 `imported_scores` |
| 体育 | 体育基础分 | 体育课成绩 + 体测等级 + 竞赛加分 |
| 能力 | 60 | + 证书/竞赛/论文/干部等加分项 |
| 美育 | 60 | + 美育活动/竞赛/宿舍文明等加分项 |
| 劳动 | 60 | + 劳动课/志愿服务等加分项 |

### 4.3 学生提交计分规则

- 学生选择加分项 → 不输入分数 → 系统自动取 `scoring_items.max_score` 作为固定分值
- 学生选择奖项获得时间 → 前端使用月份选择器，后端保存为 `award_month`，格式为 `YYYY-MM`
- 申请理由 / 补充说明默认值为 `无`，学生可按需改写
- 支持次数倍增：如"献血"每次 2 分，选择 3 次 = 6 分
- 班委本人的提交直接 `assistant_approved`，跳过初审进入辅导员终审

### 4.4 后端计算流程（score.js）

```javascript
// 伪代码
for each module:
  moduleScore = SUM(submissions where status='approved') + SUM(imported_scores)
  if module.id in [1,4,5,6]:   // 德育/能力/美育/劳动
    moduleScore = 60 + moduleScore
  totalScore += moduleScore * module.weight / 100
```

---

## 五、审核流转机制

### 5.1 状态机

```
学生提交材料
  ├─ 班委本人 → status = 'assistant_approved'（直接到辅导员） 
  └─ 普通学生 → status = 'pending'
       └─ 班委初审
            ├─ 驳回 → 'rejected'
            └─ 通过 → 'assistant_approved'
                 └─ 辅导员终审
                      ├─ 驳回 → 'rejected'
                      └─ 通过 → 'approved'（计入总分）
```

### 5.2 审核列表过滤规则

- **班委**：只看到本班 `status='pending'` 的材料（不含自己的材料）
- **辅导员**：看到负责班级中 `assistant_approved` 的材料。如果班级有助理则看不到 `pending`（等助理先审），无助理班级可直接审 `pending`
- 被驳回的材料学生可修改后重新提交（`rejected → pending`）

### 5.3 审核 API

| 操作 | API | 说明 |
|------|-----|------|
| 获取审核列表 | `GET /counselor/review?yearId=xxx` | 辅导员 |
| 获取审核列表 | `GET /assistant/review?yearId=xxx` | 班委 |
| 通过 | `PUT /{role}/review/:id` `{"action":"approve"}` | 班委通过→assistant_approved，辅导员通过→approved |
| 驳回 | `PUT /{role}/review/:id` `{"action":"reject","reason":"原因"}` | 驳回原因存入 rejection_reason |

---

## 六、文件上传与预览

### 6.1 上传配置

| 参数 | 值 |
|------|-----|
| 引擎 | multer.diskStorage |
| 上传根目录 | `UPLOAD_ROOT`，默认 `public/uploads` |
| 临时目录 | `{UPLOAD_ROOT}/_incoming/` |
| 最终目录 | `{UPLOAD_ROOT}/{学年}/{学号}/` |
| 大小限制 | 默认 10 MB，可通过 `UPLOAD_MAX_SIZE` 调整 |
| 格式限制 | JPG / PNG / GIF 图片 |
| 文件名校验 | `validateMagicNumber()` 检查文件头魔数（防止扩展名伪造） |
| 数据库存储 | `submissions.proof_path` 只存相对路径，如 `2025-2026/2025010101/xxx.jpg` |
| 获奖月份 | `submissions.award_month`，格式 `YYYY-MM` |

不配置 `UPLOAD_ROOT` 时默认使用 `public/uploads`。生产环境建议配置到代码目录外，例如 `/data/zongce/uploads`，避免代码发布、前端构建或清理静态文件时误碰学生证明图片。数据库与文件夹必须一一对应，管理员可在导出中心执行“检查图片一致性”。

学生上传图片时，服务端会统一生成最终文件名：

```
学号_姓名_加分项类别_分值分_学生自定义名称.后缀
```

例如：

```
2025010101_张三_体育类_5分_校运会100米获奖证书.jpg
```

学生提交材料时，前端会提交以下核心字段：

| 字段 | 说明 |
|------|------|
| `academicYearId` | 学年 ID 或学年名称 |
| `moduleId` / `itemId` | 加分模块与加分项 |
| `award_month` | 奖项获得月份，格式 `YYYY-MM`，可为空 |
| `description` | 申请理由，默认 `无` |
| `proof_name` | 学生自定义图片名称 |
| `proof` | JPG / PNG / GIF 图片文件 |

### 6.2 文件下载/预览链路

```
前端 openProofFile(id)
  → fetch GET /api/files/proof/:id (Bearer Token)
  → canAccessStudent() 权限校验
     ├─ admin → 全部可看
     ├─ student → 只能看自己的
     ├─ assistant → 同班可看
     └─ counselor → 负责班级可看
  → sendFile() → inline 预览图片
```

### 6.3 上传进度条

- `MaterialUploadModal` 使用 `XMLHttpRequest` + `xhr.upload.onprogress`
- 弹窗内显示百分比进度条（琥珀→翠绿渐变）
- 选文件后显示文件大小/剩余容量/进度条

### 6.4 材料删除与清理

材料删除统一采取「删除数据库记录 + 同步物理删除证明图片」策略，所有删除动作写入审计日志：

- **学生**：只能删除本人待审核 / 已驳回的材料（`pending` / `rejected`），接口受学年锁定保护
- **辅导员**：可删除负责班级内任意状态的材料，后端按班级归属校验拒绝跨班操作
- **管理员**：可删除全院任意材料，用于清理违规或不留记录的内容

删除已通过（`approved`）的材料会影响对应学生综测成绩，删除后成绩重新计算；归档锁定的学年一律拒绝删除，保证历史成绩可溯源。因历史原因或删除失败残留的孤立图片，由管理员在导出中心「检查图片一致性」后一键清理（见 7.3）。

---

## 七、成绩导出

### 7.1 导出格式

| 格式 | 场景 | 说明 |
|------|------|------|
| `.xlsx` | 辅导员/管理员标准登分表 | 35 列，双层表头，6 模块合并标题，按总分降序排名 |
| `.csv` | 旧版兼容 | 六模块分 + 总分排名 |
| `.zip` | 证明图片批量整理 | 流式导出，文件名固定为“学号_姓名_类别_分值_自定义名称” |

### 7.2 导出路由

| 路由 | 权限 |
|------|------|
| `GET /counselor/export/score-table?format=xlsx&className=xxx&yearId=xxx` | counselor |
| `GET /assistant/export/score-table?format=xlsx&yearId=xxx` | assistant |
| `GET /admin/export/score-table?format=xlsx&className=xxx&yearId=xxx` | admin, counselor |
| `GET /admin/export/class?className=xxx&yearId=xxx` | admin, counselor（旧CSV） |
| `GET /admin/export/proofs?yearId=xxx&className=xxx&status=approved` | admin |
| `GET /counselor/export/proofs?yearId=xxx&className=xxx&status=approved` | counselor（仅负责班级） |
| `GET /assistant/export/proofs?yearId=xxx&status=approved` | assistant（仅本班） |
| `GET /admin/proofs/check?yearId=xxx` | admin，检查数据库图片路径与实际文件是否一致 |
| `POST /admin/proofs/cleanup` | admin，物理清理孤立图片（仅在数据库无引用、并限定在上传根目录内） |
| `DELETE /admin/submissions/:id` | admin，强制删除任意材料（锁定学年除外，含物理文件） |
| `DELETE /counselor/submissions/:id` | counselor，仅删除本人负责班级内的材料 |

### 7.3 图片一致性检查

管理员在“导出中心”可执行图片一致性检查。检查结果包含：

- 数据库中有 `proof_path` 但实际文件缺失
- `proof_path` 指向上传根目录之外的非法路径
- 上传目录中存在图片但数据库没有对应记录（孤立图片）
- 当前学年数据库文件数、目录图片数、正常匹配数

检查出孤立图片时，管理员可点击“删除孤立图片”将其物理删除（仅限数据库已无引用的文件，受上传根目录白名单约束，删除动作写入审计日志）。建议在批量导出证明图片前先执行该检查，确认无缺失后再下载 ZIP。

### 7.4 Excel 导入预检查

管理员批量导入学生、教师、班级、基础成绩 Excel 时，前端会先进行预检查：

- 学生：缺少学号/姓名、文件内重复学号、学院名称未匹配数据库
- 教师：缺少工号/姓名、文件内重复工号、邮箱格式错误或被占用、学院名称未匹配数据库、未填写负责班级
- 班级：缺少年级/专业/班级、文件内重复班级、学院名称未匹配数据库
- 成绩：未匹配当前可管理范围内学生、成绩列不是数字、学号缺失
- 所有导入模板第一张表中的 `示例：` 行仅用于参考，系统导入时会自动跳过，不会写入数据库
- 有风险项时会弹窗确认，管理员可取消导入并修正 Excel

---

## 八、批量导入机制

### 8.1 学生与教师导入

管理员可在“用户导入与管理”中下载 `学生导入模板.xlsx`、`教师导入模板.xlsx`，再批量导入学生和教师信息。学生和教师模板均内置一行 `示例：` 参考数据和“填写说明”工作表；导入时示例行会自动跳过，不会创建测试账号。教师模板支持 `邮箱` 列和多个负责班级，多个班级可用英文逗号、中文逗号或顿号分隔，例如 `物联网工程1班,人工智能1班`；同工号重复导入时会补充/更新邮箱，用于页面内修改密码和登录页忘记密码验证码。学生导入后会创建本地学生账号，默认密码由环境变量 `INIT_DEFAULT_PASSWORD` 控制；学生也可以在登录页通过“注册”入口自行补充邮箱、密码、专业班级和辅导员姓名。

专业班级统一以 `class_options` 为准：标准格式为 `grade=2024级`、`major=物联网工程`、`class_name=物联网工程1班`。管理员手动新增学生、教师负责班级、班委负责班级时均从数据库班级选项中选择；数据库没有对应班级时前端显示为空，需要先在“班级管理”中新增。班级可以先不绑定辅导员，后续通过班级管理或教师负责班级编辑补充。

### 8.2 班级导入

管理员可在“师生数据与班级名单管理 - 班级管理”中下载 `班级管理导入模板.xlsx`，再批量导入登录注册可选班级。模板第一张表带有 `示例：` 前缀的参考行，系统导入时会自动跳过，正式导入前可直接删除或替换为真实数据。模板识别字段如下：

| 字段 | 必填 | 示例 | 说明 |
|------|:--:|------|------|
| 学院 | - | 数据科学与工程学院 | 可填学院名称、代码或 ID；未匹配时按默认学院或空学院处理 |
| 年级 | ✅ | 2024级 | 可填 `2024` 或 `2024级`，系统保存为标准年级 |
| 专业 | ✅ | 物联网工程 | 保存到 `class_options.major` |
| 班级 | ✅ | 物联网工程1班 | 保存到 `class_options.class_name`，用于注册下拉和班级匹配 |
| 辅导员工号（可选） | - | 007 | 留空时只导入班级；填写后按工号/姓名匹配教师并绑定负责班级 |

导入前端会检查缺少年级/专业/班级、文件内重复班级、学院名称无法匹配等风险项。后端会先保存班级选项，再尝试绑定辅导员；辅导员工号错误或管理年级不一致时，不影响班级导入，但会在导入结果中提示绑定失败条数。删除班级管理中的记录会从 `class_options` 真正删除该选项，不会删除已有学生、成绩或材料数据。

### 8.3 成绩导入

管理员或辅导员可通过“基础成绩批量导入”下载对应的德育、智育、体育等成绩模板，再导入管理员规则中配置的无需材料审核的基础成绩项目。成绩模板内置一行 `示例：` 参考数据和“填写说明”工作表；导入时示例行会自动跳过，不会写入 `imported_scores`。管理员可导入全院学生；辅导员只能导入本人负责年级和班级内的学生。成绩以学号匹配并写入 `imported_scores` 表，后续综测计算、排名、导出均以数据库记录为准；同一学生、学年、板块和项目重复导入会覆盖原成绩，不会重复累计。

---

## 九、安全措施

| 措施 | 实现 |
|------|------|
| 密码哈希 | bcryptjs，salt rounds=10 |
| 记住密码 | 仅前端 localStorage 本机缓存，用户勾选且登录成功后写入，取消勾选即清除 |
| JWT 撤销 | `token_version` 字段，修改密码/角色变更后 +1，旧 token 立即失效 |
| 请求限流 | express-rate-limit：1000 次/15min（全局），10 次/15min（登录） |
| 安全头 | helmet（CSP 关闭以兼容内联脚本） |
| CORS | 生产环境必须配置 `CORS_ORIGIN` |
| 文件上传校验 | MIME 过滤 + 魔数校验（4 字节文件头） |
| 文件访问鉴权 | `/uploads` 不直接暴露，证明图片必须通过 `/api/files/proof/:id` |
| SQL 注入防护 | 参数化查询（`?` 占位符） |
| XSS 防护 | `escapeHtml()` 函数 / React 默认转义 |
| 密码保护 | bcryptjs 哈希存储，不在日志输出明文密码 |

---

## 十、部署指南

### 10.1 环境要求

- Node.js ≥ 20.x
- MySQL ≥ 8.0
- PM2（推荐）

### 10.2 首次部署

```bash
# 1. 安装后端依赖
cd /www/wwwroot/zongce && npm install

# 2. 配置环境变量
cp .env.example .env
nano .env  # 修改 DB_PASSWORD、JWT_SECRET、CORS_ORIGIN、UPLOAD_ROOT 等

# 3. 准备上传目录（UPLOAD_ROOT 不配置时可跳过，默认 public/uploads）
mkdir -p /data/zongce/uploads
chown -R www:www /data/zongce/uploads  # 按你的 Node/PM2 运行用户调整

# 4. 初始化数据库并执行迁移
npm run db:init
npm run db:migrate

# 5. 安装前端依赖并构建
cd frontend && npm install && npm run build:ui && cd ..

# 6. 启动
pm2 start server/app.js --name zongce --update-env
pm2 save && pm2 startup
```

如果是已有数据库升级，先备份 MySQL 与上传目录，再执行：

```bash
npm run db:migrate
npm run build:ui
pm2 restart zongce --update-env
```

`server/config/migrate.js` 会记录已执行迁移，并在检测到已有成绩/材料时阻止包含清空提交或成绩数据的破坏性迁移。确需重置规则时，务必先备份，再显式设置 `ALLOW_DESTRUCTIVE_MIGRATIONS=true`。

### 10.3 更新部署

```bash
# 上传新文件后
npm install
npm run db:migrate
npm run build:ui
pm2 restart zongce --update-env
```

### 10.4 回滚

每次发布前保留上一版代码目录、`public/` 构建产物、数据库备份和上传目录备份。发生问题时恢复同一版本的代码与数据库备份后重启 PM2；不要使用来源不明的静态页面覆盖当前版本。

### 10.5 生产运维

长时间运行后数据库中的审计日志会持续增长、上传图片会累积，建议把下面几条运维命令纳入 cron 定期执行：

**1. 备份(数据库 + 上传目录)**

```bash
npm run db:backup
# 自定义备份目录:
BACKUP_ROOT=/data/zongce/backups npm run db:backup
```

默认备份到 `./backups`(建议放到数据盘并定期异地拷贝), 保留最近 14 天。建议 crontab:

```cron
0 2 * * * cd /www/wwwroot/zongce && BACKUP_ROOT=/data/zongce/backups npm run db:backup >> /var/log/zongce-backup.log 2>&1
```

**审计日志清理**(默认删除 180 天前记录, 可带 `-- --days N`):

```bash
npm run db:prune-audit
npm run db:prune-audit -- --days=365
```

**上线冒烟测试**(检查首页、健康接口、上传目录隔离):

```bash
npm run smoke
```

**优雅停机说明**: 服务端已监听 `SIGTERM/SIGINT`, `pm2 restart` 时会先停止接收新请求、等待在途写操作完成后释放数据库连接池再退出(最多 10 秒)。上传或审核进行中触发重启不会被截断。

**Nginx 反向代理**: 参考 `docs/nginx-example.conf`。务必配置 `client_max_body_size`(≥ `UPLOAD_MAX_SIZE`, 默认 11m)与 `X-Real-IP/X-Forwarded-For` 透传(`TRUST_PROXY=1` 时按真实 IP 限流)。

**进程守护**: PM2 重启策略 `pm2 start server/app.js --name zongce --update-env --max-memory-restart 500M`；如需自动拉起可配合 `pm2 startup`。

### 10.6 环境变量说明

| 变量 | 必须 | 默认值 | 说明 |
|------|:--:|--------|------|
| `DB_HOST` | ✅ | localhost | MySQL 地址 |
| `DB_PORT` | - | 3306 | MySQL 端口 |
| `DB_NAME` | ✅ | zongce | 数据库名 |
| `DB_USER` | ✅ | root | 数据库用户 |
| `DB_PASSWORD` | ✅ | - | 数据库密码 |
| `JWT_SECRET` | ✅ | - | JWT 签名密钥 |
| `PORT` | - | 3000 | 监听端口 |
| `NODE_ENV` | - | development | 环境模式 |
| `CORS_ORIGIN` | 生产✅ | - | 允许的跨域域名 |
| `INIT_DEFAULT_PASSWORD` | - | 随机 | 新建用户初始密码 |
| `UPLOAD_ROOT` | - | public/uploads | 证明图片存储根目录，生产建议配置到代码目录外 |
| `SMTP_HOST` | 邮箱验证码✅ | - | 邮件服务器地址 |
| `SMTP_PORT` | 邮箱验证码✅ | 465 | 邮件服务器端口 |
| `SMTP_SECURE` | - | true | 是否使用 SSL/TLS |
| `SMTP_USER` | 邮箱验证码✅ | - | 发件邮箱账号 |
| `SMTP_PASS` | 邮箱验证码✅ | - | 发件邮箱授权码或密码 |
| `SMTP_FROM` | - | SMTP_USER | 发件人显示名称 |
| `DB_CONNECT_TIMEOUT` | - | 10000 | 建连超时(毫秒) |
| `DB_IDLE_TIMEOUT` | - | 60000 | 空闲连接回收时间(毫秒) |

开源仓库只提交 `.env.example` 与 `frontend/.env.example`。真实 `.env`、数据库密码、JWT 密钥、SMTP 授权码和上传图片目录不要提交到 GitHub。前端示例环境文件只保留 `VITE_BACKEND_API_URL`，数据库、JWT、SMTP 等配置统一放在项目根目录 `.env` 中由后端读取。

---

## 十一、常见问题排查

### Q1: 学生注册提示“姓名与已导入学生信息不一致”

A: 说明管理员已导入该学号，但注册填写的姓名和数据库中的姓名不同。请管理员在“用户导入与管理”核对学生姓名后再注册。

### Q2: 学生提交材料后看不到记录

A: 确认 `submission.js` 的 `findByStudent` 已 JOIN `students` 表返回 `student_code`（学号字符串），否则前端 `studentId` 匹配失效。

### Q3: 辅导员看不到审核材料

A: 检查 `teacher_classes` 表是否为该辅导员分配了班级。通过管理员账号 → 用户与管理 → 教师列表 → 📋 编辑班级。

### Q4: 文件打开显示 "未提供认证令牌"

A: 前端 `openProofFile()` 使用 `fetch` + `Authorization: Bearer` header，不依赖新标签页。如果仍报 401，检查 `auth.js` 是否正确读取 header。

### Q5: 导出表格为空

A: 确认后端 `scoreTableController.js` 已上传最新版（35 列格式）。前端下载使用 `fetch` + Blob URL 方式，不依赖 `<a>` 标签。

### Q6: 登录提示“学号或密码错误，请先注册或联系管理员”

A: 学生账号只走本地认证。第一次使用的学生请点击登录页“注册”，或由管理员批量导入学生后使用初始密码登录。

### Q7: 学生上传图片失败或提示没有权限写入

A: 检查 `UPLOAD_ROOT` 指向的目录是否存在，以及 Node/PM2 运行用户是否有写权限：

```bash
mkdir -p /data/zongce/uploads
chown -R www:www /data/zongce/uploads
pm2 restart zongce --update-env
```

如果没有配置 `UPLOAD_ROOT`，系统默认写入 `public/uploads`。

### Q8: 证明图片 ZIP 导出失败，提示数据库路径找不到文件

A: 管理员进入“导出中心”点击“检查图片一致性”。如果出现缺失文件，说明数据库 `proof_path` 有记录但上传目录中对应图片不存在；如果出现孤立图片，说明目录中有图片但数据库没有记录。请优先恢复备份中的图片或修正数据库路径，再重新导出。

### Q9: 更新后学生提交材料报 `Unknown column 'award_month'`

A: 说明服务器代码已更新，但数据库迁移还没执行。进入项目根目录运行：

```bash
npm run db:migrate
pm2 restart zongce --update-env
```

### Q10: 管理员新增学生或编辑教师负责班级时，班级下拉为空

A: 班级选择只读取数据库 `class_options` 中有效存在的记录，不再支持手动输入。请先用管理员账号进入“师生数据与班级名单管理 - 班级管理”，新增或批量导入标准班级，例如 `2024级 / 物联网工程 / 物联网工程1班`。辅导员不是必选项，可以后续再绑定。

### Q11: 登录页“记住密码”缓存在哪里，如何清除

A: 勾选“记住密码”并登录成功后，账号和密码会写入当前浏览器的 `localStorage`。取消勾选会立即清除缓存；也可以在浏览器开发者工具中删除 `zongce.rememberedLogin`。

---

## 十二、开发调试

```bash
# 本地启动后端（无 PM2）
node server/app.js

# 本地构建前端
cd frontend && npm run build:ui

# TypeScript 类型检查
cd frontend && npx tsc --noEmit

# 查看日志
pm2 logs zongce --lines 50

# 测试学生登录
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"account":"24170025","password":"xxx"}'

# 测试导出
TOKEN="<jwt>" && curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/counselor/export/score-table?format=xlsx&className=24%E7%89%A9%E8%81%94%E7%BD%91%E5%B7%A5%E7%A8%8B1%E7%8F%AD&yearId=2025-2026" \
  -o test.xlsx
```

---

> 本文档适用于 V2.0 所有版本。项目源码结构、数据库设计和业务逻辑受 MIT 许可保护。
