// A range slider's value from a pointer's position on it (no DOM: the page and the tests share it). The browser draws
// the thumb's centre from thumb / 2 to size - thumb / 2 along the track, so a press on the thumb keeps its value and a
// press on the track jumps there.
//   pos, start, size: the pointer and the track along the slider's axis (clientX and the rect's left and width, or
//     clientY and its top and height); thumb: the thumb's length along it (px)
//   reverse: the value grows the other way (a vertical slider with its top end at max)
export function sliderValue({ pos, start, size, thumb = 16, min, max, step = 1, reverse = false }) {
  if (!(max > min)) return min;
  let f = (pos - start - thumb / 2) / Math.max(1, size - thumb);
  f = Math.min(1, Math.max(0, f));
  if (reverse) f = 1 - f;
  const v = min + Math.round((f * (max - min)) / step) * step;
  return Math.min(max, Math.max(min, Math.round(v * 1e6) / 1e6));
}

// where the thumb's centre is for a value (the inverse: for tests and for pressing on the thumb)
export function thumbAt({ value, start, size, thumb = 16, min, max, reverse = false }) {
  let f = max > min ? (value - min) / (max - min) : 0;
  if (reverse) f = 1 - f;
  return start + thumb / 2 + f * Math.max(1, size - thumb);
}
