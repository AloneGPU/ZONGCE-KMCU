# 开源部署与维护指南

本文是本仓库的实际部署说明，适用于本地开发、测试环境和 Linux 生产环境。项目已采用人工 Excel 导入模式，未包含也不依赖任何教务系统自动登录或自动同步功能。

## 1. 发布包说明

本仓库是可直接初始化的新项目源码，包含：

| 路径 | 是否包含 | 用途 |
| --- | :---: | --- |
| `frontend/` | 是 | React + TypeScript 前端源码 |
| `server/` | 是 | Express API、鉴权、导入导出和文件处理 |
| `database/` | 是 | 首次建库脚本和增量迁移 |
| `public/uploads/.gitkeep` | 是 | 空上传目录占位文件 |
| `public/assets/` | 否 | 由 `npm run build:ui` 自动生成 |
| `.env` | 否 | 生产密钥、数据库口令、邮件授权码，必须自行创建 |
| `node_modules/` | 否 | 通过 `npm ci` 安装 |
| 上传证明图片、Excel、数据库备份 | 否 | 业务数据，不应提交到 GitHub |

首次克隆后必须构建前端，Express 才能从 `public/` 托管页面。

## 2. 功能范围

### 2.1 角色与权限

| 角色 | 主要职责 | 不能做的事 |
| --- | --- | --- |
| 管理员 | 管理学年、评分规则、学生、教师、注册班级、辅导员、全院成绩与全量导出 | 不参与学生材料审核 |
| 辅导员 | 管理本人负责年级和班级内的学生、终审材料、导入本班成绩、导出本人负责班级的成绩 | 不可查看或导出其他班级、年级或全院数据 |
| 班委 | 对系统平均分配给本人的本班材料做初审 | 不可审核自己的材料，不可终审 |
| 学生 | 注册、邮箱验证、找回和修改密码、提交材料、查看个人成绩 | 不可修改综测规则或审核材料 |

材料状态流转如下：

```text
学生提交 -> 待班委初审 -> 初审通过，待辅导员终审 -> 终审通过，计入综测
                       \-> 初审驳回
辅导员终审              \-> 终审驳回
```

一个班级有多位班委时，待初审材料会按当前任务量优先、随机打散的方式分配，尽量保持工作量均衡。

### 2.2 班级与年级约定

- `students.grade` 保存年级，例如 `2024级`。
- `students.class_name` 保存不带年级前缀的专业班级，例如 `物联网工程1班`。
- 注册页面的专业、班级、可选辅导员由 `class_options` 和 `teacher_classes` 共同决定。
- 学号以 `24` 开头时，系统可推断为 `2024级`；批量导入仍建议显式提供年级列。
- 同一专业不同年级不混淆：成绩、辅导员权限和注册辅导员匹配均同时依据年级与班级。
- 管理员在“师生数据与班级名单管理 > 班级管理”维护注册选项。修改班级名或专业时，系统会同步相关学生资料和教师负责班级关联。

## 3. 环境要求

| 项目 | 建议版本 | 说明 |
| --- | --- | --- |
| Node.js | 20 LTS 或更高 | 前后端构建与 API 服务 |
| npm | 10 或更高 | 使用 lockfile 固定依赖版本 |
| MySQL | 8.0 或兼容版本 | 字符集应支持 `utf8mb4` |
| Linux | Rocky Linux / AlmaLinux / Ubuntu 等 | 生产部署推荐 |
| PM2 | 最新稳定版 | 建议用于生产进程守护 |
| Nginx | 最新稳定版 | 建议提供 HTTPS 和反向代理 |

本地开发可只使用 Node.js 和 MySQL。邮件验证码功能需要可用的 SMTP 账户；生产环境中该项为服务启动必填配置。

## 4. 本地首次启动

### 4.1 准备 MySQL

创建一个具备建库权限的 MySQL 用户，或在 `.env` 中暂时使用本地管理员账号。以下示例仅创建应用账户，密码须自行替换：

```sql
CREATE USER 'zongce'@'localhost' IDENTIFIED BY 'replace_this_password';
GRANT ALL PRIVILEGES ON zongce.* TO 'zongce'@'localhost';
FLUSH PRIVILEGES;
```

`npm run db:init` 会尝试创建 `DB_NAME` 指向的数据库。如果该账号没有 `CREATE DATABASE` 权限，请先用管理员手工执行：

```sql
CREATE DATABASE zongce CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

随后为应用账号授予对应数据库权限。

### 4.2 创建环境变量

```bash
cp .env.example .env
```

开发环境至少修改以下项：

```env
NODE_ENV=development
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=zongce
DB_USER=zongce
DB_PASSWORD=替换为数据库密码
JWT_SECRET=替换为至少32位随机字符串
INIT_ADMIN_PASSWORD=替换为至少8位管理员初始密码
INIT_DEFAULT_PASSWORD=替换为新导入用户的初始密码
```

建议用以下命令生成 JWT 密钥：

```bash
openssl rand -hex 32
```

### 4.3 安装、建库和启动

```bash
npm ci
cd frontend
npm ci
cd ..
npm run db:init
npm run db:migrate
npm run build:ui
npm start
```

浏览器访问 `http://127.0.0.1:3000`。初始管理员账号为 `admin`，密码取自 `.env` 中的 `INIT_ADMIN_PASSWORD`。

`db:init` 会拒绝操作已有表的数据库，避免误覆盖。已经部署过的系统不要执行它，日常升级只执行 `npm run db:migrate`。

### 4.4 开发模式

后端和前端可分别启动：

```bash
# 终端 1：后端 API，默认 3000 端口
npm run dev

# 终端 2：前端开发服务器
cd frontend
npm run dev
```

提交代码前至少执行：

```bash
cd frontend && npm run lint && npm run build:ui && cd ..
node --check server/app.js
```

## 5. 生产部署

### 5.1 完整 `.env` 清单

生产环境必须使用 `NODE_ENV=production`。下面是可复制的结构，所有示例值必须替换：

```env
NODE_ENV=production
PORT=3000
TRUST_PROXY=1
JSON_BODY_LIMIT=1mb

DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=zongce
DB_USER=zongce
DB_PASSWORD=replace_database_password
DB_CONNECTION_LIMIT=20

JWT_SECRET=replace_with_a_64_character_random_secret
JWT_EXPIRES_IN=24h
CORS_ORIGIN=https://zongce.example.edu.cn

INIT_DEFAULT_PASSWORD=replace_default_password
INIT_ADMIN_PASSWORD=replace_admin_password
ALLOW_DATABASE_RESET=false

UPLOAD_ROOT=/data/zongce/uploads
UPLOAD_MAX_SIZE=10485760

SMTP_HOST=smtp.example.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@example.com
SMTP_PASS=replace_smtp_authorization_code
SMTP_FROM=综测管理平台 <no-reply@example.com>

LOG_LEVEL=info
```

生产环境服务会在启动时校验 `CORS_ORIGIN`、`JWT_SECRET`、`SMTP_HOST`、`SMTP_USER`、`SMTP_PASS` 和 `UPLOAD_ROOT`。其中 `CORS_ORIGIN` 必须是前端实际访问源，例如 `https://zongce.example.edu.cn`，不能留空，也不能带 URL 路径或末尾斜杠。多个访问源可用英文逗号分隔。

### 5.2 准备上传目录

上传证明文件不应放在 Git 仓库中。以 `/data/zongce/uploads` 为例：

```bash
sudo mkdir -p /data/zongce/uploads
sudo chown -R <运行PM2的Linux用户>:<运行PM2的Linux用户> /data/zongce/uploads
sudo chmod 750 /data/zongce/uploads
```

先通过 `ps -ef | grep node` 或 `pm2 pid zongce` 确认进程实际运行用户，再替换命令中的占位符。不要把文字 `<运行PM2的Linux用户>` 原样粘贴给 `chown`。

### 5.3 PM2 启动和更新

```bash
cd /www/wwwroot/zongce
npm ci
cd frontend && npm ci && cd ..
npm run db:migrate
npm run build:ui
pm2 start server/app.js --name zongce --update-env
pm2 save
pm2 startup
```

后续更新：

```bash
cd /www/wwwroot/zongce
npm ci
npm run db:migrate
npm run build:ui
pm2 restart zongce --update-env
pm2 logs zongce --lines 100
```

仅修改前端时可同步 `frontend/`、构建后 `public/`；只同步 `public/` 不会更新 API。涉及数据结构时必须同步 `database/` 并执行迁移，涉及业务接口时必须同步 `server/`。

### 5.4 Nginx 反向代理示例

将域名、证书路径和端口按实际环境替换：

```nginx
server {
    listen 80;
    server_name zongce.example.edu.cn;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name zongce.example.edu.cn;

    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    client_max_body_size 12m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

检查并重载 Nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

## 6. 管理端初始化顺序

建议管理员按以下顺序完成新学年配置：

1. 创建或切换当前学年。
2. 在评分规则中核对六个模块、权重与加分项，确认后再开始收集材料。
3. 导入辅导员信息，填写工号、姓名、邮箱、初始密码、管理年级和一个或多个负责班级。
4. 在“班级管理”维护注册页专业、班级和对应辅导员。
5. 导入学生信息，确认年级、专业班级、学院、辅导员和初始密码。
6. 为每个班级设置班委。学生需先通过登录或注册建立本地账号。
7. 通过 Excel 导入各板块基础成绩。
8. 开放学生材料提交，完成班委初审和辅导员终审后再导出成绩。

## 7. Excel 数据导入规范

### 7.1 学生名单

在管理端下载模板。推荐表头：

| 学号 | 姓名 | 性别 | 年级 | 专业班级 | 学院 | 辅导员姓名 | 密码 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 24170001 | 示例学生 | 男 | 2024级 | 物联网工程1班 | 数据科学与工程学院 | 示例辅导员 | 初始密码 |

- 学号、姓名、专业班级必填。
- 年级可由学号推断，但正式导入应填写 `2024级` 这类标准格式。
- 同一学生重复导入会更新基础资料，不会产生重复学号。
- 班级名称应使用不带年级前缀的格式，如 `人工智能1班`，不要混用 `24人工智能1班`、`2024级人工智能一班`。

### 7.2 教师与辅导员名单

在管理端下载模板。推荐表头：

| 学院 | 年级 | 工号 | 姓名 | 邮箱 | 密码 | 负责班级 |
| --- | --- | --- | --- | --- | --- | --- |
| 数据科学与工程学院 | 2024级 | 10001 | 示例辅导员 | counselor@example.com | 初始密码 | 物联网工程1班、人工智能1班 |

- 负责班级可填写一个或多个班级，可用中文顿号、逗号或换行分隔；辅导员自助注册时也可在同一管理年级下多选负责班级。
- 邮箱建议必填。管理员统一下发账号时，辅导员后续在页面内修改密码、登录页忘记密码都需要通过账号绑定邮箱接收验证码。
- 同一工号重复导入会更新姓名、年级、学院、负责班级；填写邮箱时会同步补充或更新 `users.email`。
- 不同年级相同专业班级必须分别以“管理年级 + 负责班级”区分。
- 管理员可编辑已有辅导员的年级和班级；辅导员本人变更则需要提交申请并由管理员审批。

### 7.3 基础成绩

成绩导入以系统导出的模板为准。核心字段为：

| 学号 | 姓名 | 年级 | 专业班级 | 板块成绩 |
| --- | --- | --- | --- | --- |
| 24170001 | 示例学生 | 2024级 | 物联网工程1班 | 86.5 |

管理员在“基础成绩批量导入”可导入全院数据；辅导员仅能导入自己负责年级和班级的数据，服务端会再次校验，无法通过修改前端或表格绕过。导入项目来自当前评分规则中“不需要材料审核”的项目，支持智育、德育、体育以及按学校规则新增的基础项目。

导入前请核对学号、年级、班级。系统采用标准化匹配，能够识别常见年级前缀与中文数字班级写法，但不能以此替代数据清洗。实际写入以学号为准；同一学生、学年、板块和项目再次导入时会覆盖旧成绩，不会重复累计。

## 8. 数据库与文件存储

### 8.1 核心表

| 表 | 说明 |
| --- | --- |
| `users` | 全部账号、密码哈希、邮箱和令牌版本 |
| `students` | 学生学籍基础资料 |
| `teachers` | 教师和辅导员资料 |
| `teacher_classes` | 辅导员负责班级关联 |
| `class_options` | 登录注册页可选专业班级 |
| `submissions` | 学生材料与审核状态 |
| `imported_scores` | Excel 批量导入基础成绩 |
| `scoring_modules`、`scoring_items` | 综测模块、加分项与分值 |
| `email_verification_codes` | 注册、找回密码和改密验证码 |
| `audit_logs` | 管理和审批操作审计记录 |

### 8.2 图片一致性

材料文件保存于 `UPLOAD_ROOT/{学年}/{学号}/`，数据库在 `submissions.proof_path` 保存相对路径。下载和预览必须经过鉴权 API，不通过 Express 静态目录公开暴露。

管理员可以在导出中心检查数据库路径与实际文件是否一一对应，并导出按“学号 + 姓名 + 板块 + 分值 + 学生自定义名称”命名的图片 ZIP。

### 8.3 备份策略

每天至少备份一次数据库和上传目录，且放在不同于应用服务器的存储位置：

```bash
mysqldump -u zongce -p zongce > /backup/zongce_$(date +%F).sql
tar -C /data/zongce -czf /backup/zongce_uploads_$(date +%F).tar.gz uploads
```

恢复前必须先在测试环境验证备份完整性。数据库和上传目录必须按同一时间点恢复，否则材料路径可能失配。

## 9. API 概览

所有业务接口以 `/api` 为前缀；除登录、注册、验证码与健康检查外，均使用：

```http
Authorization: Bearer <JWT>
```

| 资源 | 主要接口 | 说明 |
| --- | --- | --- |
| 认证 | `/api/auth/login`、`/register`、`/send-code`、`/reset-password`、`/change-password` | 登录、注册、邮箱验证码和密码维护 |
| 管理员 | `/api/admin/*` | 人员、班级、规则、导入导出、学年、公告 |
| 辅导员 | `/api/counselor/*` | 本人班级概览、审核、成绩导入、班级导出、变更申请 |
| 班委 | `/api/assistant/*` | 被分配材料的初审 |
| 学生 | `/api/student/*` | 成绩、材料提交、个人数据 |
| 文件 | `/api/files/*` | 经授权的证明文件读取、下载和归档 |
| 健康检查 | `/api/health` | 返回服务与数据库状态 |

接口详情可从 `server/routes/` 和相应控制器获取；前端统一请求封装位于 `frontend/src/services/api.ts`。

## 10. 安全要求

1. 永不提交 `.env`、SQL 备份、上传材料、生产日志或学生 Excel。
2. `JWT_SECRET` 至少 32 位，泄露后立即更换并重启服务，使旧会话失效。
3. 邮箱只使用 SMTP 授权码，不使用登录密码；授权码泄露后立即在邮件服务商处撤销。
4. 生产环境必须使用 HTTPS，并限制数据库仅对应用服务器开放。
5. 上传目录权限应只授予运行 Node/PM2 的账户，禁止 Web 根目录直接访问。
6. 升级数据库前执行备份；检查迁移内容，禁止在有业务数据的环境中贸然启用破坏性迁移。
7. 管理员初始密码仅用于首次登录，首次启用后应立即修改。

## 11. 常见运维检查

服务无法启动：

```bash
pm2 logs zongce --lines 100
curl http://127.0.0.1:3000/api/health
```

检查环境变量是否生效：

```bash
cd /www/wwwroot/zongce
grep -E '^(NODE_ENV|CORS_ORIGIN|UPLOAD_ROOT|SMTP_HOST)=' .env
pm2 restart zongce --update-env
```

检查迁移状态：

```bash
npm run db:migrate
```

检查上传目录权限：

```bash
ls -ld /data/zongce/uploads
ps -ef | grep '[n]ode'
```

## 12. 开源协作

- 问题报告请提供系统版本、复现步骤、期望结果、实际结果和已脱敏日志。
- 不要把账户、邮箱授权码、JWT、数据库口令、学生资料或材料图片放入 Issue、PR、截图和提交记录。
- 提交前运行前端类型检查、生产构建与修改模块的后端语法检查。
- 数据库结构变更必须提供新的、可重复运行的迁移文件；不要修改已发布的历史迁移。

详细约定请参阅 [贡献指南](../CONTRIBUTING.md)。

## 13. 第三方组件与许可证

本项目以 [MIT License](../LICENSE) 发布。界面中的 3D Prism 背景参考了 React Bits，相关声明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。引入或替换第三方依赖时，请确认许可证与项目发布方式兼容，并同步更新第三方声明。
