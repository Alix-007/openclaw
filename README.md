# PR 146988 isolated proof

This branch contains only evidence tooling, not a replacement product checkout. It checks immutable product revision 501e289e4acef40a68f171b3e2666d8a00241fbc in a separate directory on Linux and Windows.

The workflow cannot write PR descriptions, comments, labels, or product branches. It runs existing focused tests and the real source detector against disposable filesystem fixtures, then uploads the observed JSON. No repository secrets are used. Successful availability checks do not promise a future process launch will succeed. No completed run is claimed by this source file.
