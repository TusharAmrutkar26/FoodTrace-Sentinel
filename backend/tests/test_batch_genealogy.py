from tests.conftest import batch_payload


def create_batch(client, references, code, *, quantity="100.000", unit="kg"):
    response = client.post(
        "/api/v1/batches",
        json=batch_payload(
            references,
            batch_code=code,
            quantity=quantity,
            unit=unit,
        ),
    )
    assert response.status_code == 201
    return response.json()


def create_edge(
    client,
    parent,
    child,
    relationship_type="transformation",
    *,
    source_quantity=None,
    source_unit=None,
):
    payload = {
        "parent_batch_id": parent["id"],
        "child_batch_id": child["id"],
        "relationship_type": relationship_type,
    }
    if source_quantity is not None:
        payload["source_quantity"] = source_quantity
        payload["source_unit"] = source_unit
    return client.post("/api/v1/genealogy", json=payload)


def test_create_split_relationships_and_retrieve_immediate_genealogy(
    client, references
):
    parent = create_batch(client, references, "SPLIT-PARENT")
    child_one = create_batch(client, references, "SPLIT-CHILD-1", quantity="60.000")
    child_two = create_batch(client, references, "SPLIT-CHILD-2", quantity="40.000")

    first = create_edge(
        client, parent, child_one, "split", source_quantity="60.000", source_unit="kg"
    )
    second = create_edge(
        client, parent, child_two, "split", source_quantity="40.000", source_unit="kg"
    )
    graph = client.get("/api/v1/batches/SPLIT-PARENT/genealogy")
    child_graph = client.get("/api/v1/batches/SPLIT-CHILD-1/genealogy")

    assert first.status_code == second.status_code == 201
    assert first.json()["source_quantity"] == "60.000"
    assert graph.status_code == 200
    assert graph.json()["batch"]["id"] == parent["id"]
    assert len(graph.json()["parents"]) == 0
    assert [edge["child"]["batch_code"] for edge in graph.json()["children"]] == [
        "SPLIT-CHILD-1",
        "SPLIT-CHILD-2",
    ]
    assert child_graph.json()["parents"][0]["parent"]["batch_code"] == "SPLIT-PARENT"


def test_merge_keeps_quantities_from_different_units_separate(client, references):
    mangoes = create_batch(client, references, "MERGE-MANGO", quantity="8.000", unit="kg")
    cartons = create_batch(client, references, "MERGE-CARTONS", quantity="20", unit="each")
    finished = create_batch(client, references, "MERGE-FINISHED", quantity="5", unit="each")

    from_kg = create_edge(
        client, mangoes, finished, "merge", source_quantity="2.500", source_unit="kg"
    )
    from_each = create_edge(
        client, cartons, finished, "merge", source_quantity="3", source_unit="each"
    )
    upstream = client.get("/api/v1/batches/MERGE-FINISHED/trace?direction=upstream")

    assert from_kg.status_code == from_each.status_code == 201
    assert upstream.status_code == 200
    assert {edge["source_unit"] for edge in upstream.json()["relationships"]} == {
        "kg",
        "each",
    }
    assert {item["batch_code"] for item in upstream.json()["batches"]} == {
        "MERGE-MANGO",
        "MERGE-CARTONS",
    }


def test_upstream_and_downstream_trace_walk_all_explicit_edges(client, references):
    source = create_batch(client, references, "TRACE-SOURCE")
    middle = create_batch(client, references, "TRACE-MIDDLE")
    side = create_batch(client, references, "TRACE-SIDE")
    target = create_batch(client, references, "TRACE-TARGET")
    create_edge(client, source, middle)
    create_edge(client, source, side, "split")
    create_edge(client, middle, target)

    upstream = client.get("/api/v1/batches/TRACE-TARGET/trace?direction=upstream").json()
    downstream = client.get("/api/v1/batches/TRACE-SOURCE/trace?direction=downstream").json()

    assert upstream["root"]["batch_code"] == "TRACE-TARGET"
    assert {(item["batch_code"], item["depth"]) for item in upstream["batches"]} == {
        ("TRACE-MIDDLE", 1),
        ("TRACE-SOURCE", 2),
    }
    assert {(item["batch_code"], item["depth"]) for item in downstream["batches"]} == {
        ("TRACE-MIDDLE", 1),
        ("TRACE-SIDE", 1),
        ("TRACE-TARGET", 2),
    }
    assert len(upstream["relationships"]) == 2
    assert len(downstream["relationships"]) == 3


def test_self_duplicate_missing_and_cyclic_relationships_are_rejected(
    client, references
):
    first = create_batch(client, references, "CYCLE-A")
    second = create_batch(client, references, "CYCLE-B")
    third = create_batch(client, references, "CYCLE-C")

    self_link = create_edge(client, first, first)
    initial = create_edge(client, first, second)
    duplicate = create_edge(client, first, second, "merge")
    missing_parent = client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": 999,
            "child_batch_id": third["id"],
            "relationship_type": "transformation",
        },
    )
    missing_child = client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": first["id"],
            "child_batch_id": 999,
            "relationship_type": "transformation",
        },
    )
    second_edge = create_edge(client, second, third)
    cycle = create_edge(client, third, first)

    assert self_link.status_code == 422
    assert initial.status_code == second_edge.status_code == 201
    assert duplicate.status_code == 409
    assert missing_parent.status_code == missing_child.status_code == 404
    assert cycle.status_code == 409


def test_quantity_units_and_split_allocations_are_validated_exactly(
    client, references
):
    parent = create_batch(client, references, "QUANTITY-PARENT", quantity="10.000")
    first = create_batch(client, references, "QUANTITY-CHILD-1")
    second = create_batch(client, references, "QUANTITY-CHILD-2")
    third = create_batch(client, references, "QUANTITY-CHILD-3")

    valid = create_edge(
        client, parent, first, "split", source_quantity="6.250", source_unit="kg"
    )
    remaining = create_edge(
        client, parent, second, "split", source_quantity="3.750", source_unit="kg"
    )
    wrong_unit = create_edge(
        client, parent, third, "transformation", source_quantity="1", source_unit="g"
    )
    over_parent_quantity = create_edge(
        client, parent, third, "transformation", source_quantity="10.001", source_unit="kg"
    )
    zero_quantity = create_edge(
        client, parent, third, "transformation", source_quantity="0", source_unit="kg"
    )
    over_split_allocation = create_edge(
        client, parent, third, "split", source_quantity="0.001", source_unit="kg"
    )
    missing_unit = client.post(
        "/api/v1/genealogy",
        json={
            "parent_batch_id": parent["id"],
            "child_batch_id": third["id"],
            "relationship_type": "transformation",
            "source_quantity": "1.000",
        },
    )

    assert valid.status_code == remaining.status_code == 201
    assert valid.json()["source_quantity"] == "6.250"
    assert wrong_unit.status_code == over_parent_quantity.status_code == 422
    assert zero_quantity.status_code == 422
    assert over_split_allocation.status_code == missing_unit.status_code == 422


def test_batch_updates_cannot_break_recorded_source_unit_or_quantity(
    client, references
):
    parent = create_batch(client, references, "UPDATE-PARENT", quantity="10.000")
    child_one = create_batch(client, references, "UPDATE-CHILD-1")
    child_two = create_batch(client, references, "UPDATE-CHILD-2")
    create_edge(client, parent, child_one, "split", source_quantity="6", source_unit="kg")
    create_edge(client, parent, child_two, "split", source_quantity="4", source_unit="kg")

    reduce = client.patch("/api/v1/batches/UPDATE-PARENT", json={"quantity": "9.999"})
    change_unit = client.patch("/api/v1/batches/UPDATE-PARENT", json={"unit": "g"})

    assert reduce.status_code == change_unit.status_code == 409
