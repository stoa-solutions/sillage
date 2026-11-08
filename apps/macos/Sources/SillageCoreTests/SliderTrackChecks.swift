import Foundation
import SillageKit

/// The slider's track: the knob stays inside, the pointer maps to the range, steps clamp.
func sliderTrackChecks() throws {
  let seek: ClosedRange<Double> = 0...200
  try expect(SliderTrack.fraction(of: 50, in: seek) == 0.25, "Fraction along the track")
  try expect(
    SliderTrack.fraction(of: -5, in: seek) == 0 && SliderTrack.fraction(of: 999, in: seek) == 1,
    "Fraction left the track")
  try expect(SliderTrack.fraction(of: 3, in: 1...1) == 0, "Degenerate range divided by zero")
  try expect(SliderTrack.fraction(of: .nan, in: seek) == 0, "NaN moved the knob")
  // A 100-point track with a 10-point knob: the knob's centre runs from 5 to 95.
  try expect(
    SliderTrack.knobCenter(fraction: 0, width: 100, knob: 10) == 5
      && SliderTrack.knobCenter(fraction: 1, width: 100, knob: 10) == 95,
    "Knob left the track")
  try expect(SliderTrack.value(atX: 50, width: 100, knob: 10, in: seek) == 100, "Pointer mapping")
  try expect(
    SliderTrack.value(atX: -40, width: 100, knob: 10, in: seek) == 0
      && SliderTrack.value(atX: 400, width: 100, knob: 10, in: seek) == 200,
    "Pointer outside the track left the range")
  try expect(
    SliderTrack.stepped(197, by: 5, forward: true, in: seek) == 200
      && SliderTrack.stepped(2, by: 5, forward: false, in: seek) == 0
      && SliderTrack.stepped(10, by: 5, forward: true, in: seek) == 15,
    "Arrow step")
}
