# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile

# The secure store is reached only from Rust, over JNI.
#
# R8 cannot see that: no Kotlin or Java calls store, retrieve, hasSecret or
# clear, so the release build removed them and every call arrived as
# NoSuchMethodError from a thread with no stack trace worth reading. The debug
# build is not minified, which is exactly why this only breaks in release --
# the shape of bug that reaches users and never the developer.
#
# nativeRegister survived on its own because MainActivity calls it, which is
# what made the failure look like a partly working bridge rather than a
# stripped one.
-keep class com.p00rija.cryptography.SecureStore { *; }

# The UnifiedPush connector is reached from Rust over JNI and from the system
# by intent. R8 sees neither, and the same NoSuchMethodError as the secure
# store would appear only in release builds.
-keep class com.p00rija.cryptography.UnifiedPush { *; }
-keep class com.p00rija.cryptography.UnifiedPushReceiver { *; }

# Reached from Rust over JNI, and instantiated by WorkManager by class name.
# R8 can see neither.
-keep class com.p00rija.cryptography.MailPoller { *; }
