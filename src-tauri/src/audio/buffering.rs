use sha2::{Digest, Sha256};

pub const TARGET_SAMPLE_RATE: u32 = 16_000;

#[derive(Debug, Clone)]
pub struct AudioChunk {
    pub bytes: Vec<u8>,
}

#[derive(Debug, Default)]
pub struct AudioNormalizer {
    source_rate: Option<u32>,
    source_channels: Option<u32>,
    next_output_pos: f64,
    carry_sample: Option<f32>,
}

impl AudioNormalizer {
    pub fn process_interleaved_f32(
        &mut self,
        samples: &[f32],
        source_rate: u32,
        channels: u32,
    ) -> Option<AudioChunk> {
        if samples.is_empty() || source_rate == 0 || channels == 0 {
            return None;
        }

        if self.source_rate != Some(source_rate) || self.source_channels != Some(channels) {
            self.source_rate = Some(source_rate);
            self.source_channels = Some(channels);
            self.next_output_pos = 0.0;
            self.carry_sample = None;
        }

        let mono = downmix_to_mono(samples, channels as usize);
        if mono.is_empty() {
            return None;
        }

        let mut working = Vec::with_capacity(mono.len() + usize::from(self.carry_sample.is_some()));
        if let Some(sample) = self.carry_sample {
            working.push(sample);
        }
        working.extend(mono);

        if working.len() < 2 {
            self.carry_sample = working.last().copied();
            return None;
        }

        let step = source_rate as f64 / TARGET_SAMPLE_RATE as f64;
        let mut output = Vec::new();
        while self.next_output_pos + 1.0 < working.len() as f64 {
            let index = self.next_output_pos.floor() as usize;
            let fraction = (self.next_output_pos - index as f64) as f32;
            let left = working[index];
            let right = working[index + 1];
            output.push(left + ((right - left) * fraction));
            self.next_output_pos += step;
        }

        self.next_output_pos -= (working.len() - 1) as f64;
        self.carry_sample = working.last().copied();

        if output.is_empty() {
            return None;
        }

        Some(AudioChunk {
            bytes: to_int16_le_bytes(&output),
        })
    }
}

fn downmix_to_mono(samples: &[f32], channels: usize) -> Vec<f32> {
    if channels == 1 {
        return samples.to_vec();
    }

    let frame_count = samples.len() / channels;
    let mut mono = Vec::with_capacity(frame_count);
    for frame in 0..frame_count {
        let mut total = 0.0_f32;
        for channel in 0..channels {
            total += samples[(frame * channels) + channel];
        }
        mono.push(total / channels as f32);
    }
    mono
}

fn to_int16_le_bytes(samples: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(samples.len() * 2);
    for sample in samples {
        let clamped = sample.clamp(-1.0, 1.0);
        let int_sample = if clamped < 0.0 {
            (clamped * i16::MAX as f32).round() as i16
        } else {
            (clamped * i16::MAX as f32).round() as i16
        };
        bytes.extend_from_slice(&int_sample.to_le_bytes());
    }
    bytes
}

#[derive(Debug, Default, Clone, PartialEq)]
pub struct FinalizedUtterance {
    pub speaker_id: Option<String>,
    pub speaker_label: Option<String>,
    pub speaker_confidence: Option<f64>,
    pub text: String,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
}

#[derive(Debug, Default)]
pub struct FinalizedUtteranceBuilder {
    utterances: Vec<FinalizedUtterance>,
}

impl FinalizedUtteranceBuilder {
    pub fn push(
        &mut self,
        speaker_id: Option<&str>,
        speaker_label: Option<&str>,
        speaker_confidence: Option<f64>,
        text: &str,
        start_ms: Option<i64>,
        end_ms: Option<i64>,
    ) {
        let utterance = FinalizedUtterance {
            speaker_id: speaker_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            speaker_label: speaker_label
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string),
            speaker_confidence,
            text: normalize_transcript_text(text),
            start_ms,
            end_ms,
        };
        self.push_utterance(utterance);
    }

    pub fn push_utterance(&mut self, utterance: FinalizedUtterance) {
        if utterance.text.is_empty() {
            return;
        }

        if let Some(last) = self.utterances.last_mut() {
            if can_merge_utterances(last, &utterance) {
                last.text = normalize_transcript_text(&format!("{} {}", last.text, utterance.text));
                if last.start_ms.is_none() {
                    last.start_ms = utterance.start_ms;
                }
                last.end_ms = utterance.end_ms.or(last.end_ms);
                last.speaker_confidence =
                    merge_confidence(last.speaker_confidence, utterance.speaker_confidence);
                if last.speaker_label.is_none() {
                    last.speaker_label = utterance.speaker_label;
                }
                return;
            }
        }

        self.utterances.push(utterance);
    }

    pub fn push_utterances<I>(&mut self, utterances: I)
    where
        I: IntoIterator<Item = FinalizedUtterance>,
    {
        for utterance in utterances {
            self.push_utterance(utterance);
        }
    }

    pub fn flush(&mut self) -> Vec<FinalizedUtterance> {
        if self.utterances.is_empty() {
            return Vec::new();
        }

        std::mem::take(&mut self.utterances)
    }

    pub fn is_empty(&self) -> bool {
        self.utterances.is_empty()
    }
}

fn can_merge_utterances(left: &FinalizedUtterance, right: &FinalizedUtterance) -> bool {
    left.speaker_id == right.speaker_id
        && left.speaker_label == right.speaker_label
        && !left.text.is_empty()
        && !right.text.is_empty()
}

fn merge_confidence(left: Option<f64>, right: Option<f64>) -> Option<f64> {
    match (left, right) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

pub fn normalize_transcript_text(input: &str) -> String {
    input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

pub fn dedupe_key(
    source: &str,
    speaker_id: Option<&str>,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
    text: &str,
) -> String {
    let normalized = normalize_transcript_text(text).to_lowercase();
    let mut digest = Sha256::new();
    digest.update(source.as_bytes());
    digest.update(b":");
    digest.update(speaker_id.unwrap_or_default().trim().as_bytes());
    digest.update(b":");
    digest.update(start_ms.unwrap_or_default().to_string().as_bytes());
    digest.update(b":");
    digest.update(end_ms.unwrap_or_default().to_string().as_bytes());
    digest.update(b":");
    digest.update(normalized.as_bytes());
    hex::encode(digest.finalize())
}

#[cfg(test)]
mod tests {
    use super::{dedupe_key, AudioNormalizer, FinalizedUtteranceBuilder, TARGET_SAMPLE_RATE};

    #[test]
    fn normalizes_to_target_rate() {
        let mut normalizer = AudioNormalizer::default();
        let source_rate = 48_000;
        let frames = 480;
        let mut samples = Vec::with_capacity(frames * 2);
        for index in 0..frames {
            let sample = ((index as f32 / frames as f32) * 0.5) - 0.25;
            samples.push(sample);
            samples.push(sample);
        }

        let chunk = normalizer
            .process_interleaved_f32(&samples, source_rate, 2)
            .expect("resampler should produce samples");

        let sample_count = chunk.bytes.len() / 2;
        assert_eq!(
            sample_count,
            frames / (source_rate / TARGET_SAMPLE_RATE) as usize
        );
    }

    #[test]
    fn utterance_builder_merges_same_speaker_and_clears() {
        let mut builder = FinalizedUtteranceBuilder::default();
        builder.push(
            Some("dg:0"),
            Some("Speaker 1"),
            Some(0.8),
            "I can own",
            Some(10),
            Some(100),
        );
        builder.push(
            Some("dg:0"),
            Some("Speaker 1"),
            Some(0.7),
            "the backend fix",
            Some(101),
            Some(200),
        );

        let utterances = builder.flush();
        assert_eq!(utterances.len(), 1);
        assert_eq!(utterances[0].speaker_id.as_deref(), Some("dg:0"));
        assert_eq!(utterances[0].speaker_label.as_deref(), Some("Speaker 1"));
        assert_eq!(utterances[0].speaker_confidence, Some(0.7));
        assert_eq!(utterances[0].text, "I can own the backend fix");
        assert_eq!(utterances[0].start_ms, Some(10));
        assert_eq!(utterances[0].end_ms, Some(200));
        assert!(builder.is_empty());
    }

    #[test]
    fn utterance_builder_splits_speaker_switches() {
        let mut builder = FinalizedUtteranceBuilder::default();
        builder.push(
            Some("dg:0"),
            Some("Speaker 1"),
            None,
            "I can take the backend fix.",
            Some(10),
            Some(200),
        );
        builder.push(
            Some("dg:1"),
            Some("Speaker 2"),
            None,
            "I will handle the frontend follow-up.",
            Some(201),
            Some(400),
        );

        let utterances = builder.flush();
        assert_eq!(utterances.len(), 2);
        assert_eq!(utterances[0].speaker_id.as_deref(), Some("dg:0"));
        assert_eq!(utterances[1].speaker_id.as_deref(), Some("dg:1"));
        assert!(builder.is_empty());
    }

    #[test]
    fn dedupe_key_is_stable() {
        let left = dedupe_key("capture", Some("dg:0"), Some(1_000), Some(2_000), "Hello   world");
        let right = dedupe_key("capture", Some("dg:0"), Some(1_000), Some(2_000), "hello world");
        assert_eq!(left, right);
    }
}
