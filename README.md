# Whisper: send all text form fields literally

Product head: `d7193d9b29bfdf9edd478be1219a57aebc3500d9`. BASE: `be82aeb77bbc08661080049650679dc602d8d197`.

The existing `openai-whisper-api` skill documents model/language text selectors and `OPENAI_BASE_URL` for a compatible proxy/local gateway. Shell quoting does not disable curl `-F` file/form interpretation. This one complete repair switches all four remaining text fields to the already-used `--form-string`; the intentional audio file `-F` and existing prompt handling stay intact. No model support, validation, endpoint or default is added.

## Actual shipped-helper proof

`whisper-text-fields-proof.py` launches `bash "$CHECKOUT/skills/openai-whisper-api/scripts/transcribe.sh"` with ordinary system curl, isolated HOME/tmp, a tiny synthetic WAV and a synthetic key. The existing configurable base URL points at its loopback HTTP multipart recorder; it reads actual received parts and output files. Product shell/curl/serialization/output are not replaced. This proves wire behavior, not hosted transcription accuracy or any specific third-party model compatibility.

| Scenario | BASE | HEAD |
| --- | --- | --- |
| Normal model/en, JSON-to-text output | Correct audio/text/output | Same legal control |
| Literal synthetic model alias `@local/whisper`, no corresponding file | curl26; no complete multipart request/adapter response; prior output preserved | Literal model text received; audio correct; output read back |
| Model `@` followed by existing synthetic file | Its contents uploaded as another file part | Literal text; zero synthetic private bytes |
| Language `<` followed by existing synthetic file | Its contents substituted into text part | Literal text; zero synthetic private bytes |
| Model `custom;type=application/json` | Model truncated to `custom` | Complete literal selector received |
| Prompt beginning with `@` | Already literal | Same legal control |

These are transport contract checks: arbitrary language markers are not advertised as valid hosted language codes. No real secret is used. The alias case BASE recorder observed one **incomplete POST**; its retained internal result identifier contains `BEFORE_HTTP`, but that identifier must not be read as zero HTTP requests. Only zero complete multipart requests/adapter responses is claimed. The two fixed-value fields are corrected for consistent text ownership, not presented as separate exploitable defects.

- [Full BASE receipt](base-receipt.json)
- [Full exact-head GREEN receipt](head-receipt.json)
- [Checks, scope and limitations](checks-summary.json)

## Reproduce

The same frozen collector, SHA256 `8337b4a596ae7a70dabdceb81074735ddf011a575d44c17209ec48e53690cbc0`, runs on separate clean BASE/HEAD checkouts. `NODE26` means the Node26 executable already required by the helper; Python3, Bash and normal curl must be installed. No TypeScript dependency installation/build is needed for the shell-only repair.

```sh
python3 whisper-text-fields-proof.py "$CHECKOUT" "$NEW_OUTPUT" "$NODE26" red
# Same command and scenarios in the clean candidate checkout, new output path:
python3 whisper-text-fields-proof.py "$CHECKOUT" "$NEW_OUTPUT" "$NODE26" green
```

Both builds use the exact committed script byte hash recorded in their receipts. The six HEAD cells passed in3.742s; syntax and diff checks pass. A fresh independent agent reviewed the complete owner and all four changes, findings empty; the official review helper was not run. Three immediately preceding human-merged fixes in this same script supply accepted serialization/output precedent; this closes the remaining text fields together instead of opening one PR per field. No test harness is committed to the product branch.

## Cleanup and limits

All owned HTTP receivers and subprocesses are joined. Only isolated synthetic files/configuration are used and retained; original WAV/private fixture bytes are checked unchanged. Existing output is preserved on the BASE missing-alias failure. No paid provider, real channel, model configuration or production service is touched. Not tested: actual OpenAI/model service, ASR quality, other operating systems/curl distributions, diarize speaker rendering and all format combinations. No config/protocol/schema/default/security-policy or upgrade contract changes are introduced.

The JSON receipts preserve all observed parts/results while substituting private local paths with `$PROOF_ROOT`, `$CHECKOUT` and `$NODE26`. Original byte hashes remain explicitly original hashes; the public manifest binds published sanitized bytes. The collector is copied without modification.
