import {Main, ReviewDecision} from './out/typescript/src-gen/Main.js';

const selected = ReviewDecision.Selected('approved');
if (selected._hx_index === 0) {
  const value: 'pending' | 'approved' = selected.value;
  void value;
}

// @ts-expect-error A caller cannot put an arbitrary string in this payload.
ReviewDecision.Selected('outside');

const result = Main.genericReview('approved');
if (result._hx_index === 0) {
  const value: 'pending' | 'approved' = result.value;
  void value;
  // @ts-expect-error The closed result cannot contain unrelated text.
  const outside: 'outside' = result.value;
  void outside;
}
