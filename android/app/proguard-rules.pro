# This is a configuration file for ProGuard.
# http://proguard.sourceforge.net/index.html#manual/usage.html

-dontusemixedcaseclassnames

# Keep Google Play Services
-keep public class com.google.android.gms.** { public *; }
-dontwarn com.google.android.gms.**

# Keep AppCompat
-keep public class androidx.appcompat.** { *; }
-keep public class androidx.core.** { *; }

# Keep Room
-keep class androidx.room.** { *; }
-keep class * extends androidx.room.RoomDatabase

# Keep Kotlin coroutines
-keep class kotlinx.coroutines.** { *; }

# Keep custom app code
-keep class com.focusfine.app.** { *; }

# Keep enums
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
