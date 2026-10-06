# Firebase

Firebase project: `dayflow-2f339`
Android package: `app.dayflow.planner`

فایل `google-services.json` در پوشه `firebase/` قرار گرفته و Workflow هنگام
ساخت پروژه Android آن را به `android/app/google-services.json` منتقل می‌کند.

این فایل شامل تنظیمات عمومی اتصال Firebase برای Android است؛ کلید API داخل آن
secret/password محسوب نمی‌شود، اما بهتر است قوانین دسترسی Firebase (خصوصاً
Firestore/Storage) در کنسول Firebase به‌درستی تنظیم شوند.
