-- 学生本地注册信息：邮箱用于后续找回密码，辅导员姓名用于学生自助登记时留痕。

ALTER TABLE users
  ADD COLUMN email VARCHAR(120) DEFAULT NULL AFTER name;

ALTER TABLE users
  ADD UNIQUE KEY uk_users_email (email);

ALTER TABLE students
  ADD COLUMN counselor_name VARCHAR(50) DEFAULT NULL AFTER gender;
