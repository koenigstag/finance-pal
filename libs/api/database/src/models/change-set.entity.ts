import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Group } from './group.entity.js';

// One write another app made through an API key — a tool call, or a batch of them — kept so it
// can be undone. The rows it touched are in change_set_rows, written by a trigger and read as they
// are, so they have no entity.
@Entity('change_sets')
export class ChangeSet {
  @PrimaryColumn({ type: 'uuid', default: () => 'gen_random_uuid()' })
  id!: string;

  @Column({ type: 'uuid', name: 'group_id' })
  groupId!: string;

  @ManyToOne(() => Group, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group!: Group;

  @Column({ type: 'uuid', name: 'created_by' })
  createdBy!: string;

  @Column({ type: 'uuid', name: 'api_key_id', nullable: true })
  apiKeyId!: string | null;

  // The key's name when the change was made.
  @Column({ type: 'text' })
  source!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  // The tool calls it was made of: [{ tool, args }].
  @Column({ type: 'jsonb' })
  steps!: { tool: string; args: Record<string, unknown> }[];

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'undone_at', nullable: true })
  undoneAt!: Date | null;
}
