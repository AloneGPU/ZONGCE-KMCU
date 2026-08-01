-- 移除历史版本自动创建的示例公告；仅匹配该固定内容，不影响管理员自行发布的公告。
DELETE FROM announcements
WHERE title = '系统已就绪'
  AND content = '综测管理平台 V2 已部署完成。管理员和辅导员可通过此系统发布通知。'
  AND sender_role = 'admin'
  AND visibility = 'all';

-- 移除历史初始化留下的默认注册班级，仅在没有学生使用且未绑定辅导员时删除。
DELETE co
FROM class_options co
LEFT JOIN students s ON s.class_name = co.class_name
LEFT JOIN teacher_classes tc ON tc.class_name = co.class_name
WHERE co.college_id = 1
  AND (co.major, co.class_name) IN (
    ('物联网工程', '物联网工程1班'),
    ('人工智能', '人工智能1班'),
    ('数据科学与大数据技术', '数据科学与大数据技术1班')
  )
  AND s.id IS NULL
  AND tc.id IS NULL;
