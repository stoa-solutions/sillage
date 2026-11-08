import Foundation

/// The arithmetic of a horizontal slider whose knob never leaves the track: where a value sits
/// along the track, which value a pointer position means, and arrow-key steps.
public enum SliderTrack {
  /// 0 at the lower bound, 1 at the upper one, clamped; a degenerate range reads as 0.
  public static func fraction(of value: Double, in range: ClosedRange<Double>) -> Double {
    let span = range.upperBound - range.lowerBound
    guard span > 0, value.isFinite else { return 0 }
    return min(max((value - range.lowerBound) / span, 0), 1)
  }
  /// The knob's centre along a track of `width` for a knob of diameter `knob`.
  public static func knobCenter(
    fraction: Double, width: Double, knob: Double
  ) -> Double {
    knob / 2 + max(width - knob, 0) * fraction
  }
  /// The value under a pointer at `x`, the knob's centre following the pointer within the
  /// track; outside it, the bounds.
  public static func value(
    atX x: Double, width: Double, knob: Double, in range: ClosedRange<Double>
  ) -> Double {
    let usable = max(width - knob, 1)
    let position = min(max((x - knob / 2) / usable, 0), 1)
    return range.lowerBound + position * (range.upperBound - range.lowerBound)
  }
  /// One arrow-key step, clamped to the range.
  public static func stepped(
    _ value: Double, by step: Double, forward: Bool, in range: ClosedRange<Double>
  ) -> Double {
    forward ? min(range.upperBound, value + step) : max(range.lowerBound, value - step)
  }
}
