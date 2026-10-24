import Foundation
import RecallAudio
import Speech

@main struct AudioTests {
  @MainActor static func main() async {
    var errors: [String] = []
    var speechRequests = 0
    let denied = Microphone(
      microphonePermission: { false },
      speechPermission: {
        speechRequests += 1
        return .authorized
      })
    denied.onError = { errors.append($0) }
    await denied.toggle()
    precondition(
      !denied.active && errors.count == 1 && speechRequests == 0,
      "Denied microphone must stop before asking for speech")
    let speechDenied = Microphone(microphonePermission: { true }, speechPermission: { .denied })
    speechDenied.onError = { errors.append($0) }
    await speechDenied.toggle()
    precondition(!speechDenied.active && errors.count == 2, "Denied speech must restore idle state")

    var permission: CheckedContinuation<Bool, Never>?
    let pending = Microphone(
      microphonePermission: {
        await withCheckedContinuation { permission = $0 }
      },
      speechPermission: {
        speechRequests += 1
        return .authorized
      })
    pending.onError = { errors.append($0) }
    let start = Task { await pending.toggle() }
    while permission == nil { await Task.yield() }
    precondition(pending.starting && pending.active, "Permission wait must be visible")
    await pending.toggle()
    precondition(!pending.active, "Second click must cancel pending startup")
    permission?.resume(returning: true)
    await start.value
    precondition(
      !pending.active && speechRequests == 0 && errors.count == 2,
      "Stale permission result must not start recording or emit an error")
    pending.stop()
    pending.stop()
    precondition(!pending.active, "Repeated cancellation must be safe")
    print("5 microphone lifecycle regression checks passed (no hardware capture)")
  }
}
