# Writer position contract

Run the focused contract with:

```bash
yarn test:writer-position
```

The compiler writer sends text to an output sink. In debug and source-map
builds, it also tracks the generated line and column after each write.

This contract gives the writer exact expected positions for empty text, plain
text, Unicode, CRLF, multiple newlines, and leading or trailing newlines. It
also makes sure that the sink receives identical text and closes once.

The expected values are independent examples. The contract does not calculate
them with the position algorithm that it checks.
