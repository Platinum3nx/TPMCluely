#import <AppKit/AppKit.h>
#import <AVFoundation/AVFoundation.h>
#import <AudioToolbox/AudioToolbox.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreMedia/CoreMedia.h>
#import <Foundation/Foundation.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>

typedef void (*TPMAudioCallback)(const float *samples,
                                 size_t frameCount,
                                 uint32_t sampleRate,
                                 uint32_t channels,
                                 double ptsMs,
                                 void *userData);
typedef void (*TPMEventCallback)(int32_t eventType, const char *message, void *userData);

static char *TPMDuplicateCString(NSString *value) {
    NSData *data = [[value ?: @"" dataUsingEncoding:NSUTF8StringEncoding] copy];
    char *buffer = calloc(data.length + 1, sizeof(char));
    if (buffer != NULL && data.length > 0) {
        memcpy(buffer, data.bytes, data.length);
    }
    return buffer;
}

static int32_t TPMDecodeScreenPermission(void) {
    if (@available(macOS 10.15, *)) {
        return CGPreflightScreenCaptureAccess() ? 1 : 0;
    }
    return 3;
}

int32_t tpm_get_screen_recording_permission_status(void) {
    return TPMDecodeScreenPermission();
}

int32_t tpm_request_screen_recording_permission(void) {
    if (@available(macOS 10.15, *)) {
        return CGRequestScreenCaptureAccess() ? 1 : 2;
    }
    return 3;
}

int32_t tpm_get_microphone_permission_status(void) {
    AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
    switch (status) {
        case AVAuthorizationStatusAuthorized:
            return 1;
        case AVAuthorizationStatusDenied:
            return 2;
        case AVAuthorizationStatusRestricted:
            return 3;
        case AVAuthorizationStatusNotDetermined:
        default:
            return 0;
    }
}

@interface TPMSystemAudioCapture : NSObject <SCStreamOutput, SCStreamDelegate>

@property(nonatomic, assign) TPMAudioCallback audioCallback;
@property(nonatomic, assign) TPMEventCallback eventCallback;
@property(nonatomic, assign) void *userData;
@property(nonatomic, strong) SCStream *stream;
@property(nonatomic, strong) dispatch_queue_t queue;

- (instancetype)initWithAudioCallback:(TPMAudioCallback)audioCallback
                        eventCallback:(TPMEventCallback)eventCallback
                             userData:(void *)userData;
- (BOOL)startWithKind:(NSString *)kind
             sourceId:(uint32_t)sourceId
                error:(NSError **)error;
- (void)stopCapture;

@end

@implementation TPMSystemAudioCapture

- (instancetype)initWithAudioCallback:(TPMAudioCallback)audioCallback
                        eventCallback:(TPMEventCallback)eventCallback
                             userData:(void *)userData {
    self = [super init];
    if (self) {
        _audioCallback = audioCallback;
        _eventCallback = eventCallback;
        _userData = userData;
        _queue = dispatch_queue_create("com.cluely.desktop.audio", DISPATCH_QUEUE_SERIAL);
    }
    return self;
}

- (BOOL)startWithKind:(NSString *)kind
             sourceId:(uint32_t)sourceId
                error:(NSError **)error {
    if (@available(macOS 13.0, *)) {
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block BOOL success = NO;
        __block NSError *localError = nil;

        [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                                                  onScreenWindowsOnly:NO
                                                    completionHandler:^(SCShareableContent *content, NSError *shareableError) {
            if (shareableError != nil) {
                localError = shareableError;
                dispatch_semaphore_signal(semaphore);
                return;
            }

            SCContentFilter *filter = nil;
            if ([kind isEqualToString:@"window"]) {
                for (SCWindow *window in content.windows) {
                    if (window.windowID == sourceId) {
                        filter = [[SCContentFilter alloc] initWithDesktopIndependentWindow:window];
                        break;
                    }
                }
            } else {
                for (SCDisplay *display in content.displays) {
                    if (display.displayID == sourceId) {
                        filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
                        break;
                    }
                }
            }

            if (filter == nil) {
                localError = [NSError errorWithDomain:@"TPMSystemAudioCapture"
                                                 code:404
                                             userInfo:@{NSLocalizedDescriptionKey: @"The selected audio source is no longer available."}];
                dispatch_semaphore_signal(semaphore);
                return;
            }

            SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
            configuration.capturesAudio = YES;
            configuration.width = 2;
            configuration.height = 2;
            configuration.queueDepth = 3;
            configuration.sampleRate = 48000;
            configuration.channelCount = 2;

            self.stream = [[SCStream alloc] initWithFilter:filter configuration:configuration delegate:self];
            NSError *addOutputError = nil;
            [self.stream addStreamOutput:self
                                    type:SCStreamOutputTypeAudio
                      sampleHandlerQueue:self.queue
                                   error:&addOutputError];
            if (addOutputError != nil) {
                localError = addOutputError;
                dispatch_semaphore_signal(semaphore);
                return;
            }

            [self.stream startCaptureWithCompletionHandler:^(NSError *startError) {
                if (startError != nil) {
                    localError = startError;
                } else {
                    success = YES;
                    if (self.eventCallback != NULL) {
                        self.eventCallback(1, "started", self.userData);
                    }
                }
                dispatch_semaphore_signal(semaphore);
            }];
        }];

        dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
        if (!success && error != NULL) {
            *error = localError;
        }
        return success;
    }

    if (error != NULL) {
        *error = [NSError errorWithDomain:@"TPMSystemAudioCapture"
                                     code:400
                                 userInfo:@{NSLocalizedDescriptionKey: @"ScreenCaptureKit requires macOS 13 or newer."}];
    }
    return NO;
}

- (void)stopCapture {
    if (self.stream == nil) {
        return;
    }

    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [self.stream stopCaptureWithCompletionHandler:^(NSError *stopError) {
        if (self.eventCallback != NULL) {
            const char *message = stopError == nil ? "stopped" : TPMDuplicateCString(stopError.localizedDescription);
            self.eventCallback(2, message, self.userData);
            if (stopError != nil && message != NULL) {
                free((void *)message);
            }
        }
        dispatch_semaphore_signal(semaphore);
    }];
    dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
    self.stream = nil;
}

- (void)stream:(SCStream *)stream didStopWithError:(NSError *)error API_AVAILABLE(macos(13.0)) {
    if (self.eventCallback != NULL) {
        char *message = TPMDuplicateCString(error.localizedDescription);
        self.eventCallback(4, message, self.userData);
        if (message != NULL) {
            free(message);
        }
    }
}

- (void)stream:(SCStream *)stream
didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer
        ofType:(SCStreamOutputType)type API_AVAILABLE(macos(13.0)) {
    if (type != SCStreamOutputTypeAudio || sampleBuffer == NULL || !CMSampleBufferIsValid(sampleBuffer)) {
        return;
    }

    CMFormatDescriptionRef description = CMSampleBufferGetFormatDescription(sampleBuffer);
    const AudioStreamBasicDescription *streamDescription = CMAudioFormatDescriptionGetStreamBasicDescription(description);
    if (streamDescription == NULL) {
        return;
    }

    size_t bufferListSize = 0;
    CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer,
                                                            &bufferListSize,
                                                            NULL,
                                                            0,
                                                            NULL,
                                                            NULL,
                                                            kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
                                                            NULL);

    AudioBufferList *bufferList = (AudioBufferList *)malloc(bufferListSize);
    if (bufferList == NULL) {
        return;
    }

    CMBlockBufferRef blockBuffer = NULL;
    OSStatus status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer,
                                                                              &bufferListSize,
                                                                              bufferList,
                                                                              bufferListSize,
                                                                              NULL,
                                                                              NULL,
                                                                              kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
                                                                              &blockBuffer);
    if (status != noErr) {
        free(bufferList);
        return;
    }

    const UInt32 channels = MAX(1u, streamDescription->mChannelsPerFrame);
    const UInt32 frameCount = (UInt32)CMSampleBufferGetNumSamples(sampleBuffer);
    const BOOL nonInterleaved = (streamDescription->mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0;
    const BOOL isFloat = (streamDescription->mFormatFlags & kAudioFormatFlagIsFloat) != 0;
    const UInt32 bitsPerChannel = streamDescription->mBitsPerChannel;

    float *interleaved = calloc(frameCount * channels, sizeof(float));
    if (interleaved == NULL) {
        if (blockBuffer != NULL) {
            CFRelease(blockBuffer);
        }
        free(bufferList);
        return;
    }

    for (UInt32 channel = 0; channel < channels; channel += 1) {
        const AudioBuffer audioBuffer = nonInterleaved ? bufferList->mBuffers[channel] : bufferList->mBuffers[0];
        const UInt8 *base = (const UInt8 *)audioBuffer.mData;
        for (UInt32 frame = 0; frame < frameCount; frame += 1) {
            const UInt32 sourceChannel = nonInterleaved ? 0 : channel;
            const UInt32 sampleIndex = nonInterleaved ? frame : (frame * channels) + sourceChannel;
            float value = 0.0f;

            if (isFloat && bitsPerChannel == 32) {
                const float *floatSamples = (const float *)base;
                value = floatSamples[sampleIndex];
            } else if (bitsPerChannel == 16) {
                const int16_t *int16Samples = (const int16_t *)base;
                value = ((float)int16Samples[sampleIndex]) / (float)INT16_MAX;
            } else if (bitsPerChannel == 32) {
                const int32_t *int32Samples = (const int32_t *)base;
                value = ((float)int32Samples[sampleIndex]) / (float)INT32_MAX;
            }

            interleaved[(frame * channels) + channel] = value;
        }
    }

    if (self.audioCallback != NULL) {
        CMTime pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer);
        double ptsMs = CMTIME_IS_VALID(pts) ? (CMTimeGetSeconds(pts) * 1000.0) : 0.0;
        self.audioCallback(interleaved,
                           frameCount,
                           (uint32_t)streamDescription->mSampleRate,
                           channels,
                           ptsMs,
                           self.userData);
    }

    free(interleaved);
    if (blockBuffer != NULL) {
        CFRelease(blockBuffer);
    }
    free(bufferList);
}

@end

char *tpm_list_system_audio_sources(const char *excludedBundleId, char **errorOut) {
    if (@available(macOS 13.0, *)) {
        dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
        __block NSString *json = @"[]";
        __block NSError *localError = nil;
        NSString *bundleId = excludedBundleId != NULL ? [NSString stringWithUTF8String:excludedBundleId] : nil;

        [SCShareableContent getShareableContentExcludingDesktopWindows:NO
                                                  onScreenWindowsOnly:NO
                                                    completionHandler:^(SCShareableContent *content, NSError *error) {
            if (error != nil) {
                localError = error;
                dispatch_semaphore_signal(semaphore);
                return;
            }

            NSMutableArray *items = [NSMutableArray array];
            for (SCWindow *window in content.windows) {
                NSString *title = window.title ?: @"";
                SCRunningApplication *application = window.owningApplication;
                NSString *appName = application.applicationName ?: @"";
                NSString *candidateBundle = application.bundleIdentifier ?: @"";
                if (window.windowID == 0 || title.length == 0) {
                    continue;
                }
                if (bundleId.length > 0 && [candidateBundle isEqualToString:bundleId]) {
                    continue;
                }

                [items addObject:@{
                    @"id": [NSString stringWithFormat:@"%u", window.windowID],
                    @"kind": @"window",
                    @"title": title,
                    @"appName": appName,
                    @"bundleId": candidateBundle,
                    @"sourceLabel": appName.length > 0 ? [NSString stringWithFormat:@"%@ - %@", appName, title] : title
                }];
            }

            for (SCDisplay *display in content.displays) {
                [items addObject:@{
                    @"id": [NSString stringWithFormat:@"%u", display.displayID],
                    @"kind": @"display",
                    @"title": [NSString stringWithFormat:@"Display %u", display.displayID],
                    @"appName": [NSNull null],
                    @"bundleId": [NSNull null],
                    @"sourceLabel": [NSString stringWithFormat:@"Display %u", display.displayID]
                }];
            }

            NSData *data = [NSJSONSerialization dataWithJSONObject:items options:0 error:&localError];
            if (data != nil) {
                json = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"[]";
            }
            dispatch_semaphore_signal(semaphore);
        }];

        dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
        if (localError != nil) {
            if (errorOut != NULL) {
                *errorOut = TPMDuplicateCString(localError.localizedDescription);
            }
            return NULL;
        }
        return TPMDuplicateCString(json);
    }

    if (errorOut != NULL) {
        *errorOut = TPMDuplicateCString(@"ScreenCaptureKit requires macOS 13 or newer.");
    }
    return NULL;
}

void *tpm_start_system_audio_capture(const char *sourceKind,
                                     uint32_t sourceId,
                                     TPMAudioCallback audioCallback,
                                     TPMEventCallback eventCallback,
                                     void *userData,
                                     char **errorOut) {
    TPMSystemAudioCapture *capture = [[TPMSystemAudioCapture alloc] initWithAudioCallback:audioCallback
                                                                             eventCallback:eventCallback
                                                                                  userData:userData];
    NSError *error = nil;
    NSString *kind = sourceKind != NULL ? [NSString stringWithUTF8String:sourceKind] : @"window";
    if (![capture startWithKind:kind sourceId:sourceId error:&error]) {
        if (errorOut != NULL) {
            *errorOut = TPMDuplicateCString(error.localizedDescription ?: @"Native system-audio capture failed to start.");
        }
        return NULL;
    }
    return (__bridge_retained void *)capture;
}

void tpm_stop_system_audio_capture(void *handle) {
    if (handle == NULL) {
        return;
    }
    TPMSystemAudioCapture *capture = (__bridge_transfer TPMSystemAudioCapture *)handle;
    [capture stopCapture];
}

void tpm_free_string(char *value) {
    if (value != NULL) {
        free(value);
    }
}
