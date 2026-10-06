# راهنمای ساخت APK

این نسخه برای رفع خطای `Dependencies lock file is not found` آماده شده است.

نکته مهم: در Workflow جدید، `actions/setup-node` هیچ npm cacheای فعال نمی‌کند؛
بنابراین وجود `package-lock.json` اجباری نیست و نصب وابستگی‌ها با:

`npm install --no-package-lock --no-audit --no-fund`

انجام می‌شود.

## اجرا در GitHub

1. محتویات این ZIP را در repository قرار دهید و روی branch `main` یا `master` push کنید.
2. در GitHub به بخش **Actions** بروید.
3. Workflow با نام **Build Android APK - Reliable** را انتخاب کنید.
4. از **Run workflow** اجرا کنید.
5. پس از موفقیت، از بخش **Artifacts** فایل `DayFlow-apk` را دریافت کنید.

اگر GitHub هنوز Workflow قدیمی را نشان می‌دهد، مطمئن شوید commit جدید روی همان branchی است که Workflow از آن اجرا می‌شود.
