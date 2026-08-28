fn main() {
    // 16 KB memory page size support for Android.
    //
    // Play rejects/warns on any AAB whose 64-bit native libraries are not 16 KB
    // aligned, and it becomes a hard block on 2026-02-01 for apps targeting
    // API 35+. NDK r28+ aligns by default; we build with r27.1.12297006, which
    // does not, so the linker needs telling.
    //
    // ⚠ WHY THIS IS HERE AND NOT IN .cargo/config.toml.
    // It was tried there first (`[target.aarch64-linux-android] rustflags`) and
    // the rebuilt .so still measured 0x1000. Cargo does not MERGE rustflags: if
    // the RUSTFLAGS environment variable is set, it replaces
    // `target.<triple>.rustflags` outright, and the tauri android build sets it.
    // `cargo:rustc-link-arg` from a build script is additive and survives that,
    // which is why the flags live here.
    //
    // VERIFY THE ARTIFACT, never this file:
    //   llvm-readelf --wide --program-headers <lib.so> | awk '/LOAD/{print $NF}'
    // every LOAD segment must read 0x4000. 0x1000 is the 4 KB default.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-arg=-Wl,-z,max-page-size=16384");
        println!("cargo:rustc-link-arg=-Wl,-z,common-page-size=16384");
    }

    tauri_build::build()
}
