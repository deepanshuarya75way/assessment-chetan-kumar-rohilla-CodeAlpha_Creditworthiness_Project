import io
from datetime import datetime, timezone
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable, KeepTogether
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas


class NumberedCanvas(canvas.Canvas):
    """
    Two-pass canvas to dynamically compute and stamp total page count (Page X of Y)
    and standardized institutional footer disclaimers on every page.
    """
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_footer_chrome(num_pages)
            super().showPage()
        super().save()

    def draw_footer_chrome(self, page_count: int):
        self.saveState()
        # Horizontal rule above footer
        self.setStrokeColor(colors.HexColor('#E2E8F0'))
        self.setLineWidth(0.75)
        self.line(36, 44, 612 - 36, 44)

        # Confidentiality & Page numbering
        self.setFont("Helvetica-Bold", 8)
        self.setFillColor(colors.HexColor('#475569'))
        self.drawString(36, 32, "Nova Credit AI • Confidential")

        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor('#64748B'))
        page_str = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(612 - 36, 32, page_str)

        # Statutory disclaimers
        self.setFont("Helvetica", 6.2)
        self.setFillColor(colors.HexColor('#94A3B8'))
        self.drawString(36, 21, "Nova Credit Score is an internal analytical score and is not an official CIBIL, FICO, Experian or lender-issued credit score.")
        self.drawString(36, 12, "This report is for informational and educational purposes and does not guarantee loan approval.")
        self.restoreState()


def draw_watermark(canvas_obj, doc):
    """
    Draws a centered, 45-degree diagonal light watermark behind the content on every page.
    """
    canvas_obj.saveState()
    # Watermark text in light unobtrusive color
    canvas_obj.setFont("Helvetica-Bold", 42)
    canvas_obj.setFillColor(colors.HexColor('#F1F5F9'))
    canvas_obj.translate(306, 410)
    canvas_obj.rotate(45)
    canvas_obj.drawCentredString(0, 16, "NOVA CREDIT AI")
    canvas_obj.setFont("Helvetica-Bold", 12)
    canvas_obj.setFillColor(colors.HexColor('#E2E8F0'))
    canvas_obj.drawCentredString(0, -10, "AI-POWERED FINANCIAL INTELLIGENCE")
    canvas_obj.restoreState()


def generate_credit_pdf(assessment_data: dict) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=36,
        leftMargin=36,
        topMargin=36,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()

    title_style = ParagraphStyle(
        'DocTitle', parent=styles['Normal'],
        fontName='Helvetica-Bold', fontSize=20, leading=24,
        textColor=colors.HexColor('#0F172A')
    )

    brand_style = ParagraphStyle(
        'BrandText', parent=styles['Normal'],
        fontName='Helvetica-Bold', fontSize=10, leading=13,
        textColor=colors.HexColor('#7C3AED')
    )

    heading_style = ParagraphStyle(
        'Heading2', parent=styles['Normal'],
        fontName='Helvetica-Bold', fontSize=11, leading=15,
        textColor=colors.HexColor('#0F172A'), spaceBefore=8, spaceAfter=4
    )

    body_style = ParagraphStyle(
        'BodyText', parent=styles['Normal'],
        fontName='Helvetica', fontSize=8.5, leading=12,
        textColor=colors.HexColor('#334155')
    )

    badge_style = ParagraphStyle(
        'BadgeText', parent=styles['Normal'],
        fontName='Helvetica-Bold', fontSize=9.5, leading=13,
        textColor=colors.HexColor('#0F172A')
    )

    meta_style = ParagraphStyle(
        'MetaText', parent=styles['Normal'],
        fontName='Helvetica', fontSize=8, leading=11,
        textColor=colors.HexColor('#64748B')
    )

    elements = []

    # ─── 1. Header Banner & Branding ──────────────────────────────────────────
    assessment_id = assessment_data.get("assessment_id") or assessment_data.get("id") or "N/A"
    short_id = assessment_id[:12]

    # Format current date as DD MMM YYYY
    now_utc = datetime.now(timezone.utc)
    formatted_date = now_utc.strftime("%d %b %Y")

    header_table_data = [
        [
            Paragraph("<b>NOVA CREDIT AI</b><br/><font size=13 color='#0F172A'><b>Credit Assessment Report</b></font>", title_style),
            Paragraph(f"<b>Assessment ID:</b> {short_id}<br/><b>Generated:</b> {formatted_date}<br/><b>Standard:</b> Institutional Risk v3", meta_style)
        ]
    ]
    header_table = Table(header_table_data, colWidths=[340, 200])
    header_table.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('ALIGN', (1,0), (1,-1), 'RIGHT'),
        ('PADDING', (0,0), (-1,-1), 0),
    ]))
    elements.append(header_table)
    elements.append(Spacer(1, 8))
    elements.append(HRFlowable(width="100%", thickness=2, color=colors.HexColor('#7C3AED'), spaceAfter=10))

    # ─── 2. Executive Assessment Summary ──────────────────────────────────────
    applicant_name = assessment_data.get("applicant_name", "Applicant")
    score_info = assessment_data.get("nova_score", {})
    nova_score = score_info.get("nova_score", 700)
    tier = score_info.get("tier", "Moderate Risk")
    decision_info = assessment_data.get("decision_engine", {})
    decision = decision_info.get("decision", "Manual Review")
    prob_pct = assessment_data.get("approval_percentage", 65.0)

    summary_data = [
        [
            Paragraph("<b>Applicant Legal Name:</b>", body_style),
            Paragraph(applicant_name, body_style),
            Paragraph("<b>Proprietary Nova Score:</b>", body_style),
            Paragraph(f"<b><font size=11 color='#7C3AED'>{nova_score} / 850</font></b>", badge_style)
        ],
        [
            Paragraph("<b>Underwriting Decision:</b>", body_style),
            Paragraph(f"<b><font color='#0D9488'>{decision}</font></b>", badge_style),
            Paragraph("<b>Credit Risk Classification:</b>", body_style),
            Paragraph(tier, body_style)
        ],
        [
            Paragraph("<b>Model Risk Confidence:</b>", body_style),
            Paragraph(f"{score_info.get('confidence_percentage', 85)}% ({score_info.get('confidence_label', 'High')})", body_style),
            Paragraph("<b>Model Risk Estimate:</b>", body_style),
            Paragraph(f"<b>{prob_pct}%</b>", body_style)
        ],
        [
            Paragraph("<b>Fixed Obligation (FOIR):</b>", body_style),
            Paragraph(f"{decision_info.get('foir_ratio', 0.3)*100:.1f}%", body_style),
            Paragraph("<b>Affordability Standing:</b>", body_style),
            Paragraph(decision_info.get('affordability_tier', 'Good'), body_style)
        ],
    ]

    summary_table = Table(summary_data, colWidths=[135, 135, 135, 135])
    summary_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,-1), colors.HexColor('#F8FAFC')),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
        ('PADDING', (0,0), (-1,-1), 5.5),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 8))

    # ─── 3. Financial Affordability & Capacity Matrix ──────────────────────────
    elements.append(Paragraph("1. Financial Capacity & Obligation Metrics", heading_style))
    metrics_data = [
        ["Financial Ratio / Metric", "Assessed Value", "Policy Threshold", "Underwriting Status"],
        ["Fixed Obligation to Income (FOIR)", f"{decision_info.get('foir_ratio', 0.3)*100:.1f}%", "Max 50.0%", "Pass" if decision_info.get('foir_ratio', 0.3) <= 0.5 else "Fail"],
        ["Debt-to-Income Ratio (DTI)", f"{decision_info.get('dti_ratio', 0.2)*100:.1f}%", "Max 40.0%", "Pass" if decision_info.get('dti_ratio', 0.2) <= 0.4 else "Fail"],
        ["Monthly Disposable Income", f"₹{decision_info.get('disposable_income', 25000):,.0f}", "Min ₹15,000", "Pass" if decision_info.get('disposable_income', 25000) >= 15000 else "Fail"],
        ["Emergency Liquidity Buffer", f"{decision_info.get('liquidity_reserve_months', 4)} Months", "Min 3.0 Months", "Pass" if decision_info.get('liquidity_reserve_months', 4) >= 3 else "Warning"],
        ["Max Recommended Monthly EMI", f"₹{decision_info.get('max_recommended_emi', 25000):,.0f}", "50% Income Ceiling", "Suggested Cap"],
        ["Estimated Eligible Loan Capacity", f"₹{decision_info.get('suggested_loan_capacity', 500000):,.0f}", "Tenure Scaled", "Pre-qualified"],
    ]

    metrics_table = Table(metrics_data, colWidths=[175, 115, 130, 120])
    metrics_table.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0F172A')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.white),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
        ('PADDING', (0,0), (-1,-1), 4.5),
    ]))
    elements.append(metrics_table)
    elements.append(Spacer(1, 8))

    # ─── 4. Multi-Tenure Loan Comparison ──────────────────────────────────────
    loan_comp = decision_info.get("loan_tenure_comparison", [])
    if loan_comp:
        elements.append(Paragraph("2. Multi-Tenure Amortization & Cost Comparison", heading_style))
        tenure_rows = [["Tenure", "Monthly EMI", "Total Interest", "Total Repayment", "FOIR", "Recommendation"]]
        for t in loan_comp:
            tenure_rows.append([
                f"{t.get('tenure_months')} Mos ({t.get('tenure_years')} Yrs)",
                f"₹{t.get('monthly_emi'):,.0f}",
                f"₹{t.get('total_interest'):,.0f}",
                f"₹{t.get('total_cost'):,.0f}",
                f"{t.get('foir_percentage')}%",
                t.get('nova_recommendation', 'Feasible')
            ])
        comp_table = Table(tenure_rows, colWidths=[90, 90, 90, 100, 70, 100])
        comp_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#334155')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,-1), 8),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
            ('PADDING', (0,0), (-1,-1), 4),
        ]))
        elements.append(comp_table)
        elements.append(Spacer(1, 8))

    # ─── 5. SHAP Drivers (Positive vs Risk) ───────────────────────────────────
    elements.append(Paragraph("3. Explainable Machine Learning Attribution (SHAP)", heading_style))
    pos_drivers = assessment_data.get("top_positive_drivers", [])
    risk_drivers = assessment_data.get("top_risk_drivers", [])

    driver_rows = [["Factor & Feature Attribution", "Attribution Weight", "Risk Direction Impact"]]
    for d in pos_drivers[:3]:
        driver_rows.append([f"↑ {d.get('feature', '')}", f"+{abs(d.get('shap_value', 0)):.3f}", "Favorable Credit Vector"])
    for d in risk_drivers[:3]:
        driver_rows.append([f"↓ {d.get('feature', '')}", f"-{abs(d.get('shap_value', 0)):.3f}", "Risk Drag Vector"])

    if len(driver_rows) > 1:
        driver_table = Table(driver_rows, colWidths=[240, 120, 180])
        driver_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#0284C7')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,-1), 8),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
            ('PADDING', (0,0), (-1,-1), 4),
        ]))
        elements.append(driver_table)
        elements.append(Spacer(1, 8))

    # ─── 6. Actionable Credit Improvement Planner ─────────────────────────────
    improvements = decision_info.get("improvement_recommendations", [])
    if improvements:
        elements.append(Paragraph("4. Recommended Credit Improvement Actions", heading_style))
        action_rows = [["Action Recommendation", "Category", "Simulated Score & Risk Impact"]]
        for a in improvements:
            action_rows.append([a.get("action", ""), a.get("category", ""), a.get("potential_impact", "")])
        act_table = Table(action_rows, colWidths=[240, 120, 180])
        act_table.setStyle(TableStyle([
            ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#059669')),
            ('TEXTCOLOR', (0,0), (-1,0), colors.white),
            ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
            ('FONTSIZE', (0,0), (-1,-1), 8),
            ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#CBD5E1')),
            ('PADDING', (0,0), (-1,-1), 4),
        ]))
        elements.append(act_table)
        elements.append(Spacer(1, 10))

    # ─── 7. Model Telemetry & Notice ──────────────────────────────────────────
    elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#CBD5E1'), spaceAfter=5))
    elements.append(Paragraph("<b>Model Telemetry:</b> Champion CatBoost + Platt Sigmoid Calibration | Pipeline v3.0.0 | Statlog German Credit Baseline (UCI)", ParagraphStyle('Meta1', parent=body_style, fontSize=7, textColor=colors.HexColor('#64748B'))))
    elements.append(Paragraph(f"<b>Analytical Notice:</b> {score_info.get('disclaimer', 'Nova Credit Score is a proprietary model-derived risk assessment and not an official bureau score.')} {decision_info.get('simulation_disclaimer', '')}", ParagraphStyle('Disc1', parent=body_style, fontSize=7, textColor=colors.HexColor('#94A3B8'))))

    doc.build(
        elements,
        onFirstPage=draw_watermark,
        onLaterPages=draw_watermark,
        canvasmaker=NumberedCanvas
    )
    buffer.seek(0)
    return buffer.getvalue()
