-- migrate:up
CREATE UNIQUE INDEX uq_folder_active_name_per_parent
  ON files.folder (parent_folder_id, lower(name))
  WHERE NOT is_deleted AND parent_folder_id IS NOT NULL;

-- migrate:down
DROP INDEX files.uq_folder_active_name_per_parent;
