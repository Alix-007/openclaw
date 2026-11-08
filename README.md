# Skill verification cancellation: real CLI receipt

Product base: 5fe1403b94d74f8a933ca50a778e6c9bfdfd7b78
Product head: d861c2afe3206d80ac92a7bce1c4fe5d97c44a5a

Run a normal cliStartup build in each clean checkout, then:

```sh
python3 collector.py "$CHECKOUT" "$NEW_OUTPUT_DIRECTORY" "$NODE26/bin/node" red
# Use green for the candidate, with the same collector and scenarios.
```

The collector starts the ordinary shipped openclaw.mjs in a real controlling Linux PTY. It serves synthetic unauthenticated ClawHub HTTP verification/card envelopes, waits until the chosen response is pending, and sends terminal VINTR. Passive peer-close observations, PTY output, native exit and matched clean build stamps are retained. Two ordinary-success controls are included.

BASE: both interrupted reads end by the product launcher's SIGKILL backstop after about2.03s. HEAD: verify exits130 in97.12ms and card in79.76ms; peers close in9.16ms and1.86ms. No watchdog kills and no ordinary result after interruption in either candidate cell. BASE already suppressed late output, so this receipt does not claim an observed baseline late-output defect.

Absolute private tool/workspace roots in receipts are replaced by $PROOF_ROOT and $NODE26; other observations are retained. The collector is unchanged. No external registry/model/channel, production service or private user data is used. Fixture state is retained for inspection and every direct child/server is joined. Linux PTY behavior only; not native Windows/macOS or a live ClawHub compatibility claim.
