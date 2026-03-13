fn main() {
    #[cfg(target_os = "macos")]
    {
        const MIN_MACOS_VERSION: &str = "12.3";

        println!("cargo:rerun-if-changed=src/audio/macos_bridge.m");
        println!("cargo:rerun-if-changed=src/window/stealth.m");
        println!("cargo:rustc-link-arg=-mmacosx-version-min={MIN_MACOS_VERSION}");

        cc::Build::new()
            .file("src/audio/macos_bridge.m")
            .flag("-fobjc-arc")
            .flag(&format!("-mmacosx-version-min={MIN_MACOS_VERSION}"))
            .compile("tpmaudio");

        cc::Build::new()
            .file("src/window/stealth.m")
            .flag("-fobjc-arc")
            .flag(&format!("-mmacosx-version-min={MIN_MACOS_VERSION}"))
            .compile("tpmstealth");

        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=AVFoundation");
        println!("cargo:rustc-link-lib=framework=CoreAudio");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
        println!("cargo:rustc-link-lib=framework=CoreGraphics");
        println!("cargo:rustc-link-lib=framework=CoreMedia");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=ScreenCaptureKit");
    }

    tauri_build::build()
}
