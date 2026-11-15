# Existing sibling validation limitations

The expanded HEAD suite records12 PASS /18 FAIL. A clean unchanged BASE run independently reproduces the same18 failed case names (17 capacity fixtures and one orphan lock expectation). All four new real-Git whitespace/ordinary controls pass. This is not reported as a fully green sibling suite. No checks or assertions were weakened. See paired logs and source/test blob bindings.
