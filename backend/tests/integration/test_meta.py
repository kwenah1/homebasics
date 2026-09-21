def test_states_lists_all_51_sorted_by_name(client):
    states = client.get("/api/v1/states").json()
    assert len(states) == 51
    assert states[0] == {"code": "AL", "name": "Alabama"}
    assert [s["name"] for s in states] == sorted(s["name"] for s in states)
    assert {"code": "TX", "name": "Texas"} in states


def test_states_is_public(client):
    assert client.get("/api/v1/states").status_code == 200
