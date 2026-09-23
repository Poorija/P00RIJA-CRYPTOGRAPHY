// P00RIJA Cryptography — offline-first encryption suite and E2EE messenger.
// Copyright (C) 2026 Poorija <p00rija@tutamail.com>
// https://github.com/Poorija/P00RIJA-Cryptography
//
// Licensed under the GNU Affero General Public License, version 3 only.
// See LICENSE for the full text. Section 13 matters here: run a modified
// version as a network service and its users are entitled to your source.

//! Where the master password lives on a phone.
//!
//! The desktop keeps it in the operating system's keyring and asks
//! LocalAuthentication, Windows Hello or the Secret Service to stand in front
//! of it. Neither mobile platform has a keyring crate, so this module reaches
//! the same guarantees through each platform's own store directly:
//!
//! * Android — an AES key created inside the Keystore with
//!   `setUserAuthenticationRequired(true)`. The key never leaves the secure
//!   element, and the operating system refuses to decrypt with it until a face
//!   or a finger has been presented. The ciphertext sits in ordinary app
//!   storage precisely because it is worthless without that key.
//! * iOS — a Keychain item whose access control carries
//!   `kSecAccessControlBiometryCurrentSet`. The item is returned only after
//!   Face ID or Touch ID succeeds, and enrolling a new face or finger
//!   invalidates it.
//!
//! In both cases the refusal is the platform's, not this app's. That is the
//! whole point: an app that decides for itself whether the fingerprint was
//! good enough protects nothing from anybody holding the storage.
//!
//! Nothing here is compiled for the desktop, which is served by the keyring
//! path in `lib.rs` and is deliberately left alone.

/// What the front end is allowed to know about the store's state.
pub struct SecureStoreState {
    /// The platform can hold a biometric-gated secret at all.
    pub available: bool,
    /// A password is stored right now.
    pub has_secret: bool,
}

#[cfg(target_os = "android")]
mod platform {
    use jni::objects::{GlobalRef, JClass, JObject, JString, JValue};
    use jni::{JNIEnv, JavaVM};
    use std::sync::OnceLock;

    /// The virtual machine and the Activity, handed over once at startup.
    ///
    /// Reaching these from Rust unprompted is the part that does not work.
    /// ndk-context is the usual answer and panics here, because Tauri never
    /// populates it -- tao keeps the activity in a private module of its own
    /// and exposes no accessor. So the traffic goes the other way, which is the
    /// direction Android is built for: MainActivity.onCreate calls into this
    /// library, and what it brings is kept for the rest of the process.
    static BRIDGE: OnceLock<Bridge> = OnceLock::new();

    struct Bridge {
        vm: JavaVM,
        context: GlobalRef,
        /// The SecureStore class itself, kept rather than looked up.
        ///
        /// FindClass on a thread attached with AttachCurrentThread resolves
        /// through the system class loader, which cannot see classes that came
        /// from the application's own APK -- so looking the class up by name at
        /// call time fails, silently and only off the main thread. Kotlin hands
        /// the class in as the second argument of every static native method,
        /// on a thread where it is already resolved, so it is kept from there.
        class: GlobalRef,
    }

    /// Called once from Kotlin. Named for the class and method that call it,
    /// which is how the JVM finds it without an explicit registration table.
    #[no_mangle]
    pub extern "system" fn Java_com_p00rija_cryptography_SecureStore_nativeRegister(
        env: JNIEnv,
        class: JClass,
        context: JObject,
    ) {
        let Ok(vm) = env.get_java_vm() else { return };
        // Global references, because local ones die when this call returns and
        // every later use would be reading freed memory.
        let Ok(context) = env.new_global_ref(context) else { return };
        let Ok(class) = env.new_global_ref(class) else { return };
        let _ = BRIDGE.set(Bridge { vm, context, class });
    }

    /// Runs `body` with an environment attached to the calling thread.
    ///
    /// Tauri's commands make no promise about which thread they run on, so the
    /// attachment is per call rather than cached.
    /// Runs `body` with an environment attached to the calling thread.
    ///
    /// Returns the failure's own text rather than swallowing it. An earlier
    /// version answered None for everything, so a class that could not be
    /// resolved and a bridge that was never registered produced the same
    /// message -- and the message named the wrong one.
    fn with_env<T>(
        body: impl FnOnce(&mut JNIEnv, &JObject, &JClass) -> Result<T, jni::errors::Error>,
    ) -> Result<T, String> {
        let bridge = BRIDGE
            .get()
            .ok_or_else(|| "the Android bridge was never registered".to_string())?;
        let mut env = bridge
            .vm
            .attach_current_thread()
            .map_err(|error| format!("attach failed: {error}"))?;
        let class = <&JClass>::from(bridge.class.as_obj());
        let result = body(&mut env, bridge.context.as_obj(), class);
        /* A pending Java exception poisons every later call on this thread.
           Describe it before clearing: the description reaches logcat, which is
           the only place a JNI failure would otherwise be visible at all. */
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

    /// False until Kotlin has registered, which is also the honest answer for
    /// the window before the activity exists.
    pub fn available() -> bool {
        BRIDGE.get().is_some()
    }

    pub fn has_secret() -> bool {
        with_env(|env, context, class| {
            env.call_static_method(
                class,
                "hasSecret",
                "(Landroid/content/Context;)Z",
                &[JValue::Object(context)],
            )?
            .z()
        })
        .unwrap_or(false)
    }

    /// The Kotlin side returns the platform's own message on failure and an
    /// empty string on success, so nothing has to cross JNI as an exception.
    pub fn store(secret: &str) -> Result<(), String> {
        let outcome = with_env(|env, context, class| {
            let value = env.new_string(secret)?;
            let out = env.call_static_method(
                class,
                "store",
                "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(context), JValue::Object(&value)],
            )?;
            let obj = out.l()?;
            if obj.is_null() {
                return Ok(String::new());
            }
            Ok(env.get_string(&JString::from(obj))?.into())
        })?;
        if outcome.is_empty() {
            Ok(())
        } else {
            Err(outcome)
        }
    }

    /// Empty when the Keystore key refused, which is what an unsatisfied
    /// prompt and an invalidated key both look like from here.
    pub fn retrieve() -> Option<String> {
        match call_string("retrieve") {
            Ok(value) if !value.is_empty() => Some(value),
            Ok(_) => None,
            Err(error) => {
                // Reaches logcat as RustStdoutStderr, the one place a JNI
                // failure on a background thread can be seen from outside.
                eprintln!("secure store: retrieve failed: {error}");
                None
            }
        }
    }

    pub fn clear() {
        let _ = call_string("clear");
    }
}

#[cfg(target_os = "ios")]
mod platform {
    use security_framework::passwords::{
        delete_generic_password, generic_password, set_generic_password_options,
    };
    use security_framework::passwords_options::{AccessControlOptions, PasswordOptions};

    const SERVICE: &str = "com.p00rija.cryptography.quickunlock";
    const ACCOUNT: &str = "master-password";

    fn options() -> PasswordOptions {
        PasswordOptions::new_generic_password(SERVICE, ACCOUNT)
    }

    pub fn available() -> bool {
        // The Keychain is always present. Whether a face or a finger is
        // enrolled is the biometric plugin's question, asked from the front end
        // before a button is drawn, because only it can answer per handset.
        true
    }

    pub fn has_secret() -> bool {
        /* Deliberately a delete-less, read-less probe: asking for the item
           itself would make the Keychain raise Face ID, and a prompt that
           appears when nobody asked to unlock anything teaches people to
           approve prompts without reading them. Reading the error apart is
           enough -- a missing item and a guarded item fail differently. */
        match generic_password(options()) {
            Ok(_) => true,
            Err(error) => {
                // errSecItemNotFound. Anything else means the item exists and
                // the platform declined to hand it over unauthenticated.
                error.code() != -25300
            }
        }
    }

    pub fn store(secret: &str) -> Result<(), String> {
        clear();
        let mut opts = options();
        /* BIOMETRY_CURRENT_SET, not BIOMETRY_ANY: enrolling a new face or
           finger destroys the item. A newly added face is a new person until
           the real owner types the password again. */
        opts.set_access_control_options(AccessControlOptions::BIOMETRY_CURRENT_SET);
        set_generic_password_options(secret.as_bytes(), opts)
            .map_err(|error| format!("the keychain refused the item ({error})"))
    }

    pub fn retrieve() -> Option<String> {
        /* Face ID or Touch ID is demanded by the Keychain on this call, because
           of the access control the item was stored under -- not by this code
           deciding the answer was good enough. */
        let bytes = generic_password(options()).ok()?;
        String::from_utf8(bytes).ok().filter(|value| !value.is_empty())
    }

    pub fn clear() {
        let _ = delete_generic_password(SERVICE, ACCOUNT);
    }
}

pub fn state() -> SecureStoreState {
    SecureStoreState {
        available: platform::available(),
        has_secret: platform::has_secret(),
    }
}

pub fn store(secret: &str) -> Result<(), String> {
    if secret.is_empty() {
        return Err("master password is empty".into());
    }
    platform::store(secret)
}

pub fn retrieve() -> Option<String> {
    platform::retrieve()
}

pub fn clear() {
    platform::clear()
}
