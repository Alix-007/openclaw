# Skill verification cancellation: repaired head receipt

Product base: 5fe1403b94d74f8a933ca50a778e6c9bfdfd7b78
Product head: ef29337d9783c4599cbe50d155d9f98b3a61f8aa

The only follow-up product-branch delta is removal of the obsolete agent-scope mock baseline entry. Production, owner tests and docs are byte-identical to the initially reviewed d861c2afe3206d80ac92a7bce1c4fe5d97c44a5a. The new clean commit was normally rebuilt and replayed, not relabeled as an old exact-head run.

The unchanged collector uses the shipped openclaw.mjs launcher in a real controlling Linux PTY, loopback HTTP and terminal Ctrl-C. It independently observes passive peer close, native process exit, drained terminal output and normal verification/card controls. BASE both interrupted cells require the launcher SIGKILL backstop near2.03s. HEAD verify exits130 in97.02ms, card88.77ms; peers close in2.16ms/1.75ms. Both ordinary controls exit0 with complete output; zero collector watchdog kills or late ordinary results in either interrupted head cell.

Normal build: `node --import ./scripts/tsx.mjs scripts/build-all.mts cliStartup`.
Replay: `python3 collector.py "$CHECKOUT" "$NEW_OUTPUT" "$NODE26/bin/node" red` on base and `green` on head.

All fixtures are disposable offline config/HOME/state; direct children/server joined. Private workspace/tool roots in receipts use $PROOF_ROOT/$NODE26; collector unchanged. No registry credentials, external model/channel or production data. Not native Windows/macOS, live ClawHub compatibility, SIGTERM or install/update proof.
