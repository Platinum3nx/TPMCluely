#import <AppKit/AppKit.h>

void tpm_set_window_sharing_none(void *ns_window) {
    if (ns_window == NULL) return;
    NSWindow *window = (__bridge NSWindow *)ns_window;
    if (@available(macOS 12.0, *)) {
        [window setSharingType:NSWindowSharingNone];
    }
}

void tpm_set_window_sharing_readwrite(void *ns_window) {
    if (ns_window == NULL) return;
    NSWindow *window = (__bridge NSWindow *)ns_window;
    if (@available(macOS 12.0, *)) {
        [window setSharingType:NSWindowSharingReadWrite];
    }
}
