CREATE TRIGGER IF NOT EXISTS task_node_membership BEFORE INSERT ON task_states
WHEN NOT EXISTS(SELECT 1 FROM workflow_instances i JOIN workflow_nodes n ON n.version_id=i.template_version_id WHERE i.id=NEW.instance_id AND n.name=NEW.node)
BEGIN SELECT RAISE(ABORT,'Task is outside its pinned template'); END;
CREATE TRIGGER IF NOT EXISTS task_node_membership_update BEFORE UPDATE OF instance_id,node ON task_states
WHEN NOT EXISTS(SELECT 1 FROM workflow_instances i JOIN workflow_nodes n ON n.version_id=i.template_version_id WHERE i.id=NEW.instance_id AND n.name=NEW.node)
BEGIN SELECT RAISE(ABORT,'Task is outside its pinned template'); END;
