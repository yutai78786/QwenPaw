

def test_canary_deliberately_failing():
    # Canary for concurrency-reduction verification: must fail so the
    # unit tier goes red and downstream sequencing can be observed.
    assert False, "canary: deliberate failure for sequencing verification"
