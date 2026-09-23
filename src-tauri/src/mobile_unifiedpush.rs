// P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
// Copyright (C) 2026 Poorija <p00rija@tutamail.com>
// https://github.com/Poorija/P00RIJA-Cryptography
//
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE for the full text. Section 13 matters here: run a modified
// version as a network service and its users are entitled to your source.

//! Reaching the UnifiedPush connector from the webview.
//!
//! Android's WebView implements service workers but does not expose the Push
//! API to them, so the browser build's push route does not exist inside the
//! native shell. UnifiedPush fills the gap without FCM: a distributor app the
//! person installed holds the socket, and the relay POSTs to the URL it hands
//! out.
//!
//! The division of labour is deliberate. Kotlin talks to the distributor,
//! because that conversation is four Android broadcasts wide. The webview
//! registers the resulting endpoint with the relay, because the relay demands
//! proof of the identity key and only the webview holds it. This module is the
//! wire between them and nothing more.
//!
//! iOS has no equivalent and needs none: APNs is the only channel Apple
//! permits, and a Home Screen web app there already receives Web Push through
//! the service worker with no developer account at all. Every command here is
//! Android-only for that reason.

use crate::NativeError;

#[cfg(target_os = "android")]
mod platform {
    use jni::objects::{GlobalRef, JClass, JObject, JString, JValue};
    use jni::{JNIEnv, JavaVM};
    use std::sync::OnceLock;

    /// Handed over by MainActivity, for the same reason the secure store's
    /// bridge is: ndk-context is never populated in a Tauri app, and a class
    /// looked up by name on an attached thread resolves through the system
    /// class loader, which cannot see this APK's classes.
    static BRIDGE: OnceLock<Bridge> = OnceLock::new();

    struct Bridge {
        vm: JavaVM,
        context: GlobalRef,
        class: GlobalRef,
        /// MailPoller, handed over by the same call. Two classes rather than
        /// one because FindClass cannot be used from an attached thread and
        /// each static native method only brings its own.
        poller: GlobalRef,
    }

    #[no_mangle]
    pub extern "system" fn Java_com_p00rija_cryptography_UnifiedPush_nativeRegister(
        mut env: JNIEnv,
        class: JClass,
        context: JObject,
    ) {
        let Ok(vm) = env.get_java_vm() else { return };
        let Ok(context) = env.new_global_ref(context) else { return };
        let Ok(class_ref) = env.new_global_ref(class) else { return };
        /* Resolved here, on the thread Kotlin called in on, where the
           application class loader is the one in force. The same lookup from a
           thread attached later goes through the system loader and finds
           nothing from this APK. */
        let Ok(poller_class) = env.find_class("com/p00rija/cryptography/MailPoller") else { return };
        let Ok(poller) = env.new_global_ref(poller_class) else { return };
        let _ = BRIDGE.set(Bridge { vm, context, class: class_ref, poller });
    }

    fn with_poller<T>(
        body: impl FnOnce(&mut JNIEnv, &JObject, &JClass) -> Result<T, jni::errors::Error>,
    ) -> Result<T, String> {
        let bridge = BRIDGE
            .get()
            .ok_or_else(|| "the UnifiedPush bridge was never registered".to_string())?;
        let mut env = bridge
            .vm
            .attach_current_thread()
            .map_err(|error| format!("attach failed: {error}"))?;
        let class = <&JClass>::from(bridge.poller.as_obj());
        let result = body(&mut env, bridge.context.as_obj(), class);
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_describe();
            let _ = env.exception_clear();
        }
        result.map_err(|error| error.to_string())
    }

    /// Empty on success; the platform's own complaint otherwise.
    pub fn poll_enable(origin: &str, token: &str) -> Result<String, String> {
        with_poller(|env, context, class| {
            let origin = env.new_string(origin)?;
            let token = env.new_string(token)?;
            let out = env.call_static_method(
                class,
                "enable",
                "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(context), JValue::Object(&origin), JValue::Object(&token)],
            )?;
            let obj = out.l()?;
            if obj.is_null() { return Ok(String::new()); }
            Ok(env.get_string(&JString::from(obj))?.into())
        })
    }

    pub fn poll_disable() -> Result<(), String> {
        with_poller(|env, context, class| {
            env.call_static_method(class, "disable", "(Landroid/content/Context;)V", &[JValue::Object(context)])?;
            Ok(())
        })
    }

    pub fn poll_enabled() -> bool {
        with_poller(|env, context, class| {
            env.call_static_method(class, "isEnabled", "(Landroid/content/Context;)Z", &[JValue::Object(context)])?.z()
        })
        .unwrap_or(false)
    }

    fn with_env<T>(
        body: impl FnOnce(&mut JNIEnv, &JObject, &JClass) -> Result<T, jni::errors::Error>,
    ) -> Result<T, String> {
        let bridge = BRIDGE
            .get()
            .ok_or_else(|| "the UnifiedPush bridge was never registered".to_string())?;
        let mut env = bridge
            .vm
            .attach_current_thread()
            .map_err(|error| format!("attach failed: {error}"))?;
        let class = <&JClass>::from(bridge.class.as_obj());
        let result = body(&mut env, bridge.context.as_obj(), class);
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_describe();
            let _ = env.exception_clear();
        }
        result.map_err(|error| error.to_string())
    }

    fn call_string(method: &str) -> Result<String, String> {
        with_env(|env, context, class| {
            let out = env.call_static_method(
                class,
                method,
                "(Landroid/content/Context;)Ljava/lang/String;",
                &[JValue::Object(context)],
            )?;
            let obj = out.l()?;
            if obj.is_null() {
                return Ok(String::new());
            }
            Ok(env.get_string(&JString::from(obj))?.into())
        })
    }

    pub fn available() -> bool {
        BRIDGE.get().is_some()
    }

    /// Every installed app that can act as a distributor, one per line.
    ///
    /// A list rather than a choice: which app holds a socket to which server
    /// on somebody's behalf is exactly the decision this feature exists to
    /// hand back, and picking silently would be FCM's paternalism wearing a
    /// different logo.
    pub fn distributors() -> Result<Vec<String>, String> {
        with_env(|env, context, class| {
            let out = env.call_static_method(
                class,
                "distributors",
                "(Landroid/content/Context;)Ljava/util/List;",
                &[JValue::Object(context)],
            )?;
            let list = out.l()?;
            if list.is_null() {
                return Ok(Vec::new());
            }
            let size = env.call_method(&list, "size", "()I", &[])?.i()?;
            let mut names = Vec::new();
            for index in 0..size {
                let item = env
                    .call_method(&list, "get", "(I)Ljava/lang/Object;", &[JValue::Int(index)])?
                    .l()?;
                if item.is_null() {
                    continue;
                }
                let name: String = env.get_string(&JString::from(item))?.into();
                names.push(name);
            }
            Ok(names)
        })
    }

    pub fn endpoint() -> Result<String, String> {
        call_string("endpoint")
    }

    pub fn distributor() -> Result<String, String> {
        call_string("distributor")
    }

    /// True when the request reached a distributor. The endpoint itself
    /// arrives later, as a broadcast, because the distributor has to talk to
    /// its own server first.
    pub fn register(package: &str) -> Result<bool, String> {
        with_env(|env, context, class| {
            let value = env.new_string(package)?;
            env.call_static_method(
                class,
                "register",
                "(Landroid/content/Context;Ljava/lang/String;)Z",
                &[JValue::Object(context), JValue::Object(&value)],
            )?
            .z()
        })
    }

    pub fn unregister() -> Result<(), String> {
        with_env(|env, context, class| {
            env.call_static_method(
                class,
                "unregister",
                "(Landroid/content/Context;)V",
                &[JValue::Object(context)],
            )?;
            Ok(())
        })
    }
}

/// What the front end needs to draw the setting and decide what to do next.
#[derive(serde::Serialize)]
pub struct UnifiedPushStatus {
    /// This build can speak UnifiedPush at all. False on iOS and on desktop.
    pub supported: bool,
    /// Distributor apps installed on this phone.
    pub distributors: Vec<String>,
    /// The one currently registered with, empty if none.
    pub distributor: String,
    /// The fifteen-minute poll is armed. Only ever true when somebody asked
    /// for it: it costs a bearer token at rest and a request on a schedule.
    pub polling: bool,
    /// The URL to hand the relay, empty until a distributor has answered.
    pub endpoint: String,
}

pub fn status() -> UnifiedPushStatus {
    #[cfg(target_os = "android")]
    {
        if !platform::available() {
            return UnifiedPushStatus {
                supported: false,
                distributors: Vec::new(),
                distributor: String::new(),
                endpoint: String::new(),
                polling: false,
            };
        }
        UnifiedPushStatus {
            supported: true,
            distributors: platform::distributors().unwrap_or_default(),
            distributor: platform::distributor().unwrap_or_default(),
            endpoint: platform::endpoint().unwrap_or_default(),
            polling: platform::poll_enabled(),
        }
    }
    #[cfg(not(target_os = "android"))]
    {
        /* iOS reaches APNs or nothing, and the desktop has a socket it can
           simply keep open. Saying "not supported" here is the truth rather
           than a gap. */
        UnifiedPushStatus {
            supported: false,
            distributors: Vec::new(),
            distributor: String::new(),
            endpoint: String::new(),
            polling: false,
        }
    }
}

/// Arms the fallback poll. The token is a bearer credential the worker keeps,
/// so an https origin is required rather than preferred.
pub fn poll_enable(_origin: &str, _token: &str) -> Result<(), NativeError> {
    #[cfg(target_os = "android")]
    {
        let complaint = platform::poll_enable(_origin, _token).map_err(NativeError::msg)?;
        if !complaint.is_empty() {
            return Err(NativeError::msg(complaint));
        }
        return Ok(());
    }
    #[cfg(not(target_os = "android"))]
    {
        Err(NativeError::msg("the mail poller is an Android-only fallback"))
    }
}

pub fn poll_disable() -> Result<(), NativeError> {
    #[cfg(target_os = "android")]
    {
        return platform::poll_disable().map_err(NativeError::msg);
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}

pub fn register(_package: &str) -> Result<bool, NativeError> {
    #[cfg(target_os = "android")]
    {
        return platform::register(_package).map_err(NativeError::msg);
    }
    #[cfg(not(target_os = "android"))]
    {
        Err(NativeError::msg("UnifiedPush is an Android-only transport"))
    }
}

pub fn unregister() -> Result<(), NativeError> {
    #[cfg(target_os = "android")]
    {
        return platform::unregister().map_err(NativeError::msg);
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(())
    }
}
