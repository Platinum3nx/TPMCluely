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

#[derive(Debug, Default, Clone)]
pub struct FinalizedUtterance {
    pub text: String,
    pub start_ms: Option<i64>,
    pub end_ms: Option<i64>,
}

#[derive(Debug, Default)]
pub struct FinalizedUtteranceBuilder {
    parts: Vec<String>,
    start_ms: Option<i64>,
    end_ms: Option<i64>,
}

impl FinalizedUtteranceBuilder {
    pub fn push(&mut self, text: &str, start_ms: Option<i64>, end_ms: Option<i64>) {
        let normalized = normalize_transcript_text(text);
        if normalized.is_empty() {
            return;
        }

        if self.start_ms.is_none() {
            self.start_ms = start_ms;
        }
        self.end_ms = end_ms.or(self.end_ms);
        self.parts.push(normalized);
    }

    pub fn flush(&mut self) -> Option<FinalizedUtterance> {
        let text = normalize_transcript_text(&self.parts.join(" "));
        if text.is_empty() {
            self.parts.clear();
            self.start_ms = None;
            self.end_ms = None;
            return None;
        }

        let utterance = FinalizedUtterance {
            text,
            start_ms: self.start_ms,
            end_ms: self.end_ms,
        };

        self.parts.clear();
        self.start_ms = None;
        self.end_ms = None;
        Some(utterance)
    }

    pub fn is_empty(&self) -> bool {
        self.parts.is_empty()
    }
}

pub fn normalize_transcript_text(input: &str) -> String {
    input.split_whitespace().collect::<Vec<_>>().join(" ").trim().to_string()
}

pub fn dedupe_key(source: &str, start_ms: Option<i64>, end_ms: Option<i64>, text: &str) -> String {
    let normalized = normalize_transcript_text(text).to_lowercase();
    let mut digest = Sha256::new();
    digest.update(source.as_bytes());
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
        assert_eq!(sample_count, frames / (source_rate / TARGET_SAMPLE_RATE) as usize);
    }

    #[test]
    fn utterance_builder_concatenates_and_clears() {
        let mut builder = FinalizedUtteranceBuilder::default();
        builder.push("I can own", Some(10), Some(100));
        builder.push("the backend fix", Some(101), Some(200));

        let utterance = builder.flush().expect("utterance should flush");
        assert_eq!(utterance.text, "I can own the backend fix");
        assert_eq!(utterance.start_ms, Some(10));
        assert_eq!(utterance.end_ms, Some(200));
        assert!(builder.is_empty());
    }

    #[test]
    fn dedupe_key_is_stable() {
        let left = dedupe_key("capture", Some(1_000), Some(2_000), "Hello   world");
        let right = dedupe_key("capture", Some(1_000), Some(2_000), "hello world");
        assert_eq!(left, right);
    }
}
