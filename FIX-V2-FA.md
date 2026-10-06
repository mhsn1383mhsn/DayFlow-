# اصلاح نسخه V2

خطای اجرای قبلی در مرحله `Setup Java 17` بود، نه Firebase و نه Node.js.

علت: `actions/setup-java` با `cache: gradle` قبل از ساخته‌شدن پروژه Android اجرا می‌شد و
فایل‌های Gradle مثل `gradle-wrapper.properties` هنوز وجود نداشتند.

اصلاح:
- `actions/setup-java` به v5 ارتقا داده شد.
- Gradle cache از setup-java حذف شد.
- `gradle/actions/setup-gradle@v4` بعد از ساخته و sync شدن پروژه Android اجرا می‌شود.

این دقیقاً برای خطای `No file in ... matched to ... gradle-wrapper.properties` است.
