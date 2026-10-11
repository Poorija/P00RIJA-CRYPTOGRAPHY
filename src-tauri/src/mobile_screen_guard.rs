// P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
// Copyright (C) 2026 Poorija <p00rija@tutamail.com>
// https://github.com/Poorija/P00RIJA-Cryptography
//
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE for the full text. Section 13 matters here: run a modified
// version as a network service and its users are entitled to your source.

//! Keeping the screen out of screenshots and screen recordings on a phone.
//!
//! Android has the one switch that does this properly: `FLAG_SECURE` on the
//! window. The system then refuses screenshots and screen recording of it and
//! shows a blank card in the recent-apps list. It is a window flag, so it
//! needs the Activity — which, as with the secure store, Rust cannot find by
//! itself; MainActivity hands it over at startup.
//!
//! The Kotlin half also remembers the choice, so the flag is on from the very
//! first frame of the next start, before the web view has drawn anything.
//!
//! iOS has no equivalent — an app cannot refuse a screenshot there — and the
//! module says so rather than pretending.

#[cfg(target_os = "android")]
mod platform {
    use jni::objects::{GlobalRef, JClass, JObject, JValue};
    use jni::{JNIEnv, JavaVM};
    use std::sync::OnceLock;

    static BRIDGE: OnceLock<Bridge> = OnceLock::new();

    struct Bridge {
        vm: JavaVM,
        activity: GlobalRef,
        /// Kept from the registering call, for the same class-loader reason
        /// the secure store gives: FindClass off the main thread cannot see
        /// the application's own classes.
        class: GlobalRef,
    }

    #[no_mangle]
    pub extern "system" fn Java_com_p00rija_cryptography_ScreenGuard_nativeRegister(
        env: JNIEnv,
        class: JClass,
        activity: JObject,
    ) {
        let Ok(vm) = env.get_java_vm() else { return };
        let Ok(activity) = env.new_global_ref(activity) else { return };
        let Ok(class) = env.new_global_ref(class) else { return };
        let _ = BRIDGE.set(Bridge { vm, activity, class });
    }

    pub fn apply(enabled: bool) -> Result<bool, String> {
        let bridge = BRIDGE
            .get()
            .ok_or_else(|| "the screen guard bridge was never registered".to_string())?;
        let mut env = bridge
            .vm
            .attach_current_thread()
            .map_err(|error| format!("attach failed: {error}"))?;
        let class = <&JClass>::from(bridge.class.as_obj());
        let result = env.call_static_method(
            class,
            "apply",
            "(Landroid/app/Activity;Z)V",
            &[JValue::Object(bridge.activity.as_obj()), JValue::Bool(u8::from(enabled))],
        );
        if env.exception_check().unwrap_or(false) {
            let _ = env.exception_describe();
            let _ = env.exception_clear();
        }
        result.map(|_| true).map_err(|error| error.to_string())
    }
}

#[cfg(not(target_os = "android"))]
mod platform {
    /// Nothing to switch on this platform from here: the desktop uses the
    /// window's own content protection (lib.rs), and iOS has no such thing.
    pub fn apply(_enabled: bool) -> Result<bool, String> {
        Ok(false)
    }
}

/// Turns the guard on or off. `Ok(true)` means the platform now enforces it.
pub fn apply(enabled: bool) -> Result<bool, String> {
    platform::apply(enabled)
}
