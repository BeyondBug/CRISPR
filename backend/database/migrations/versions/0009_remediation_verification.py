"""Evidence-backed remediation verification workflow.

Revision ID: 0009_remediation_verification
Revises: 0008_remediation_delivery_risk
"""

from alembic import op

revision = "0009_remediation_verification"
down_revision = "0008_remediation_delivery_risk"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
    CREATE TABLE IF NOT EXISTS remediation_verifications (
      verification_id UUID PRIMARY KEY,
      organization_id UUID NOT NULL REFERENCES organizations(organization_id) ON DELETE CASCADE,
      remediation_id UUID NOT NULL REFERENCES remediation_items(remediation_id) ON DELETE CASCADE,
      result VARCHAR(16) NOT NULL CHECK (result IN ('PASSED','FAILED')),
      method VARCHAR(32) NOT NULL CHECK (method IN ('RESCAN','CONTROL_TEST','CONFIGURATION_REVIEW','MANUAL_EVIDENCE')),
      evidence_reference VARCHAR(500) NOT NULL,
      evidence_summary VARCHAR(2000) NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      verifier_id UUID NOT NULL REFERENCES users(user_id),
      model_version VARCHAR(120),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ix_remediation_verifications_tenant_ticket
      ON remediation_verifications(organization_id,remediation_id,created_at DESC);
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS remediation_verifications;")
