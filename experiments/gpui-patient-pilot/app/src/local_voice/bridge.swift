import AVFAudio
import Foundation

// Cattura per il motore whisper: microfono, conversione a 16 kHz mono Float32,
// campioni consegnati a Rust con MFVoiceCaptureRead. Nessun file audio; il
// buffer è preallocato e azzerato quando i campioni escono o la cattura finisce.

final class WhisperVoiceCapture: @unchecked Sendable {
    enum Phase: Int32 { case starting = 0, running, permissionDenied, failed, stopped }
    static let backlog = 16_000 * 30
    private let lock = NSLock()
    private var samples = [Float](repeating: 0, count: WhisperVoiceCapture.backlog)
    private var count = 0
    private var phase = Phase.starting
    private var started = false
    private var engine: AVAudioEngine?
    private var observer: NSObjectProtocol?
    private let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)

    private func set(_ next: Phase) {
        lock.lock(); if phase != .stopped { phase = next }; lock.unlock()
    }

    func start() {
        lock.lock()
        let first = !started
        started = true
        lock.unlock()
        guard first else { return }
        guard #available(macOS 14.0, *),
              let usage = Bundle.main.object(forInfoDictionaryKey: "NSMicrophoneUsageDescription") as? String,
              !usage.isEmpty else { set(.failed); return }
        AVAudioApplication.requestRecordPermission { [weak self] granted in
            guard let self else { return }
            if granted { self.begin() } else { self.set(.permissionDenied) }
        }
    }

    private func begin() {
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let format = input.inputFormat(forBus: 0)
        guard format.sampleRate > 0, let target,
              let converter = AVAudioConverter(from: format, to: target) else { set(.failed); return }
        input.installTap(onBus: 0, bufferSize: 4_096, format: format) { [weak self] buffer, _ in
            self?.convert(buffer, converter, target)
        }
        observer = NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: nil
        ) { [weak self] _ in self?.set(.failed) }
        engine.prepare()
        do {
            try engine.start()
            lock.lock()
            self.engine = engine
            let stopped = phase == .stopped
            if !stopped { phase = .running }
            lock.unlock()
            if stopped { input.removeTap(onBus: 0); engine.stop() }
        } catch {
            input.removeTap(onBus: 0)
            set(.failed)
        }
    }

    private func convert(_ buffer: AVAudioPCMBuffer, _ converter: AVAudioConverter, _ target: AVAudioFormat) {
        let ratio = target.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 32)
        guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { set(.failed); return }
        var fed = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, inputStatus in
            if fed { inputStatus.pointee = .noDataNow; return nil }
            fed = true
            inputStatus.pointee = .haveData
            return buffer
        }
        guard status != .error, let channel = output.floatChannelData?[0] else { set(.failed); return }
        let frames = Int(output.frameLength)
        lock.lock()
        if phase == .running {
            if count + frames > samples.count {
                phase = .failed
            } else {
                samples.withUnsafeMutableBufferPointer { destination in
                    destination.baseAddress!.advanced(by: count).update(from: channel, count: frames)
                }
                count += frames
            }
        }
        lock.unlock()
        channel.update(repeating: 0, count: frames)
    }

    func poll() -> Phase {
        lock.lock(); defer { lock.unlock() }
        return phase
    }

    func read(_ output: UnsafeMutablePointer<Float>, _ capacity: Int) -> Int {
        lock.lock(); defer { lock.unlock() }
        let n = min(capacity, count)
        guard n > 0 else { return 0 }
        samples.withUnsafeMutableBufferPointer { buffer in
            let base = buffer.baseAddress!
            output.update(from: base, count: n)
            base.update(from: base.advanced(by: n), count: count - n)
            base.advanced(by: count - n).update(repeating: 0, count: n)
        }
        count -= n
        return n
    }

    func stop() {
        lock.lock()
        let engine = self.engine
        self.engine = nil
        if phase == .starting || phase == .running { phase = .stopped }
        lock.unlock()
        if let observer { NotificationCenter.default.removeObserver(observer); self.observer = nil }
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
    }

    func wipe() {
        lock.lock()
        samples.withUnsafeMutableBufferPointer { $0.update(repeating: 0) }
        count = 0
        lock.unlock()
    }
}

@_cdecl("MFVoiceCaptureCreate")
func voiceCaptureCreate() -> UnsafeMutableRawPointer {
    Unmanaged.passRetained(WhisperVoiceCapture()).toOpaque()
}

@_cdecl("MFVoiceCaptureStart")
func voiceCaptureStart(_ pointer: UnsafeMutableRawPointer) {
    Unmanaged<WhisperVoiceCapture>.fromOpaque(pointer).takeUnretainedValue().start()
}

@_cdecl("MFVoiceCapturePoll")
func voiceCapturePoll(_ pointer: UnsafeMutableRawPointer) -> Int32 {
    Unmanaged<WhisperVoiceCapture>.fromOpaque(pointer).takeUnretainedValue().poll().rawValue
}

@_cdecl("MFVoiceCaptureRead")
func voiceCaptureRead(_ pointer: UnsafeMutableRawPointer, _ output: UnsafeMutablePointer<Float>, _ capacity: Int) -> Int {
    Unmanaged<WhisperVoiceCapture>.fromOpaque(pointer).takeUnretainedValue().read(output, capacity)
}

@_cdecl("MFVoiceCaptureStop")
func voiceCaptureStop(_ pointer: UnsafeMutableRawPointer) {
    Unmanaged<WhisperVoiceCapture>.fromOpaque(pointer).takeUnretainedValue().stop()
}

@_cdecl("MFVoiceCaptureRelease")
func voiceCaptureRelease(_ pointer: UnsafeMutableRawPointer) {
    let capture = Unmanaged<WhisperVoiceCapture>.fromOpaque(pointer).takeRetainedValue()
    capture.stop()
    capture.wipe()
}
