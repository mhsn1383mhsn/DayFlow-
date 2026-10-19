# انتقال DayFlow به Supabase

## ۱. کلیدها را در `www/index.html` بگذار

در بخش تنظیمات Supabase این دو مقدار را پیدا کن و داخل `index.html` جایگزین کن:

```js
const SB_URL  = 'https://zgpzchtmimwrknmfewqt.supabase.co';
const SB_ANON = 'کلید_publishable_یا_anon_تو';
```

- **Project URL**: در Settings → API
- **Publishable / anon key**: همان کلیدی که در صفحه API Keys می‌بینی (با `eyJ` شروع می‌شود یا در نسخه جدید با `sb_publishable_`)

> کلید publishable/anon امن است که در کلاینت باشد. **Service role key را هرگز در اپ نگذار.**

## ۲. جدول و RLS را در Supabase بساز

در داشبورد Supabase → **SQL Editor** این اسکریپت را اجرا کن:

```sql
-- جدول ذخیره دادهٔ کاربر
create table if not exists public.user_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data text not null,
  mt bigint not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

-- هر کاربر فقط دادهٔ خودش را ببیند / بنویسد / پاک کند
create policy "own data only"
  on public.user_data
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ایندکس اختیاری
create index if not exists user_data_mt_idx on public.user_data (mt);
```

## ۳. فعال‌کردن ورود با گوگل

1. در Supabase → **Authentication** → **Providers** → **Google** را روشن کن.
2. از [Google Cloud Console](https://console.cloud.google.com/) یک OAuth 2.0 Client ID بساز (نوع: Web application).
3. Client ID و Client Secret را در Supabase وارد کن.
4. در Google Cloud، **Authorized redirect URIs** را این بگذار:
   ```
   https://zgpzchtmimwrknmfewqt.supabase.co/auth/v1/callback
   ```
5. در Supabase → Authentication → URL Configuration:
   - **Site URL**: آدرس سایت/اپ (مثلاً `https://...` یا برای تست محلی)
   - **Redirect URLs**: همان آدرسی که اپ بعد از لاگین برمی‌گردد (مثلاً مسیر `index.html` یا deep link)

## ۴. ساخت APK

همان Workflow قبلی (`Build Android APK`) را اجرا کن. مراحل Firebase از workflow حذف شده‌اند.

```bash
npm install
npm run vendor   # کپی supabase.js به www/vendor
```

## تفاوت با نسخهٔ Firebase

| قبل (Firebase) | بعد (Supabase) |
|----------------|----------------|
| Firebase Auth + Google | Supabase Auth + Google OAuth |
| Firestore `users/{uid}` | جدول `user_data` |
| `@capacitor-firebase/authentication` | فقط کلاینت JS (OAuth در مرورگر/WebView) |
| `google-services.json` | دیگر لازم نیست |

## نکات

- بعد از ورود با گوگل، داده زیر `user_data` با کلید `user_id` کاربر ذخیره می‌شود.
- منطق همگام‌سازی (آخرین تغییر برنده) مثل قبل است.
- اگر روی اندروید OAuth گیر کرد، مطمئن شو Redirect URL در Supabase و Google درست ثبت شده باشد.
