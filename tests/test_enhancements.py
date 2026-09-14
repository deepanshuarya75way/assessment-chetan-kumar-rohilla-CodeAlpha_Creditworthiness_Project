"""
Integration and regression tests for Nova Credit AI enhancements:
- Local dev admin login and access controls
- Authenticated PDF generation and strict authorization (200, 401, 403, 404)
- PDF watermarking and canvas validation
- Wealth & Fund Explorer API with 15 demo funds & filtering
- Loan intelligence calculations
"""

import io
import os
import uuid
import pytest
from fastapi.testclient import TestClient
from pypdf import PdfReader

from backend.main import app
from backend.app.database.session import init_db, SessionLocal, create_user, get_user_by_email, save_assessment_orm
from backend.scripts.create_admin import provision_dev_admin

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup():
    init_db()
    provision_dev_admin()
    yield


def test_dev_admin_login_and_access():
    """Verify local development admin credentials can authenticate and access admin endpoints."""
    admin_email = os.getenv("NOVA_DEV_ADMIN_EMAIL", "admin@novacredit.local")
    admin_password = os.getenv("NOVA_DEV_ADMIN_PASSWORD", "NovaAdmin#2026!")

    res = client.post("/api/v1/auth/login", json={"email": admin_email, "password": admin_password})
    assert res.status_code == 200, f"Dev admin login failed: {res.text}"
    data = res.json()
    assert "access_token" in data
    assert data["role"] == "ADMIN"
    token = data["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Verify admin stats
    res_stats = client.get("/api/v1/admin/dashboard/stats", headers=headers)
    assert res_stats.status_code == 200
    assert "total_users" in res_stats.json()

    # Verify admin assessments
    res_ass = client.get("/api/v1/admin/assessments", headers=headers)
    assert res_ass.status_code == 200
    assert "assessments" in res_ass.json()


def test_pdf_endpoint_requires_authentication():
    """Unauthenticated request to /api/v1/reports/pdf/{id} must return 401."""
    res = client.get("/api/v1/reports/pdf/NON_EXISTENT_ID")
    assert res.status_code == 401


def test_pdf_endpoint_returns_404_for_missing_record():
    """Authenticated request for non-existent assessment returns 404."""
    email = f"user_{uuid.uuid4().hex[:6]}@example.com"
    res_reg = client.post("/api/v1/auth/register", json={"email": email, "password": "Password123!", "full_name": "Test User"})
    token = res_reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/v1/reports/pdf/ASSESS-NOT-FOUND", headers=headers)
    assert res.status_code == 404


def test_pdf_cross_user_authorization():
    """User B cannot download User A's assessment (403 Forbidden)."""
    db = SessionLocal()
    user_a = create_user(db, f"USR-A-{uuid.uuid4().hex[:6]}", f"usera_{uuid.uuid4().hex[:6]}@example.com", "Password123!", "User A")
    user_b = create_user(db, f"USR-B-{uuid.uuid4().hex[:6]}", f"userb_{uuid.uuid4().hex[:6]}@example.com", "Password123!", "User B")
    email_a = user_a.email
    email_b = user_b.email

    assessment_id = f"ASSESS-{uuid.uuid4().hex[:8].upper()}"
    payload = {"age": 32, "monthly_income": 85000.0, "credit_amount": 1500000.0, "duration": 36}
    result = {
        "nova_score": {"nova_score": 780, "tier": "Prime (Low Risk)"},
        "approval_probability": 0.88,
        "decision_engine": {"decision": "Likely Eligible", "foir_ratio": 0.32, "dti_ratio": 0.22}
    }
    save_assessment_orm(db, assessment_id, user_a.full_name, payload, result, user_a.id)
    db.close()

    # Login as User B
    res_login_b = client.post("/api/v1/auth/login", json={"email": email_b, "password": "Password123!"})
    token_b = res_login_b.json()["access_token"]
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # Attempt to access User A's report
    res_forbidden = client.get(f"/api/v1/reports/pdf/{assessment_id}", headers=headers_b)
    assert res_forbidden.status_code == 403, f"Expected 403 but got {res_forbidden.status_code}"

    # User A CAN access their report
    res_login_a = client.post("/api/v1/auth/login", json={"email": email_a, "password": "Password123!"})
    token_a = res_login_a.json()["access_token"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    res_allowed = client.get(f"/api/v1/reports/pdf/{assessment_id}", headers=headers_a)
    assert res_allowed.status_code == 200
    assert res_allowed.headers["content-type"] == "application/pdf"
    assert f"Nova_Credit_Assessment_{assessment_id}.pdf" in res_allowed.headers.get("content-disposition", "")
    assert res_allowed.content[:4] == b"%PDF"


def test_pdf_watermark_and_content():
    """Verify generated PDF contains Nova Credit AI watermark text and multi-page canvas elements."""
    db = SessionLocal()
    user = create_user(db, f"USR-{uuid.uuid4().hex[:6]}", f"user_{uuid.uuid4().hex[:6]}@example.com", "Password123!", "Jane Doe")
    user_email = user.email

    assessment_id = f"ASSESS-{uuid.uuid4().hex[:8].upper()}"
    payload = {"age": 35, "monthly_income": 120000.0, "credit_amount": 2500000.0, "duration": 60}
    result = {
        "nova_score": {"nova_score": 795, "tier": "Prime (Low Risk)"},
        "approval_probability": 0.92,
        "decision_engine": {"decision": "Likely Eligible", "foir_ratio": 0.28, "dti_ratio": 0.18},
        "shap_explanations": {"top_factors": [{"feature": "Savings Buffer", "impact": "Positive", "description": "High savings balance"}]}
    }
    save_assessment_orm(db, assessment_id, user.full_name, payload, result, user.id)
    db.close()

    res_login = client.post("/api/v1/auth/login", json={"email": user_email, "password": "Password123!"})
    token = res_login.json()["access_token"]

    res = client.get(f"/api/v1/reports/pdf/{assessment_id}", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    pdf_bytes = res.content

    reader = PdfReader(io.BytesIO(pdf_bytes))
    assert len(reader.pages) >= 1
    page1_text = reader.pages[0].extract_text()
    assert "NOVA CREDIT AI" in page1_text
    assert "Page 1 of" in page1_text
    assert "Applicant" in page1_text  # Applicant label is rendered in the PDF
    assert "795" in page1_text


def test_wealth_funds_api():
    """Verify wealth funds endpoint returns 15 records, demo disclaimer, and category filtering."""
    res = client.get("/api/v1/wealth/funds")
    assert res.status_code == 200
    data = res.json()
    assert data["is_demo"] is True
    assert "disclaimer" in data
    assert data["total"] == 15
    assert len(data["funds"]) == 15

    # Test category filter
    res_eq = client.get("/api/v1/wealth/funds?category=Equity")
    assert res_eq.status_code == 200
    eq_data = res_eq.json()
    assert all(f["category"] == "Equity" for f in eq_data["funds"])
    assert eq_data["total"] >= 5

    # Test risk filter
    res_low = client.get("/api/v1/wealth/funds?risk=Low")
    assert res_low.status_code == 200
    low_data = res_low.json()
    assert all(f["risk_tier"] == "Low" for f in low_data["funds"])


def test_loan_calculation_api():
    """Verify loan calculation math, end date, and insights with authentication."""
    email = f"user_{uuid.uuid4().hex[:6]}@example.com"
    res_reg = client.post("/api/v1/auth/register", json={"email": email, "password": "Password123!", "full_name": "Test User"})
    token = res_reg.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    payload = {
        "principal": 1000000.0,
        "annual_rate": 9.5,
        "tenure_months": 24,
        "loan_type": "Personal",
        "processing_fee_val": 1.0,
        "processing_fee_type": "percentage"
    }
    res = client.post("/api/v1/loans/calculate", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["monthly_emi"] > 0
    assert data["total_interest"] > 0
    assert data["total_payment"] > 1000000.0
    assert data["processing_fee"] == 10000.0
    assert "end_date" in data
    assert "nova_insight" in data


