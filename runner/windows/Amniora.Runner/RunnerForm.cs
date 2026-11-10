using System.Diagnostics;
using System.Drawing;

namespace Amniora.Runner;

internal sealed class RunnerForm : Form
{
    private readonly TableLayoutPanel _status = new() { AutoSize = true, Dock = DockStyle.Top, ColumnCount = 2 };
    private readonly Label _account = TextLabel("Not connected", 10);
    private readonly Label _runtime = TextLabel("No active runtime", 10);
    private readonly Label _activity = TextLabel("Runner started", 10);
    private readonly NotifyIcon _tray;
    private bool _quitting;
    internal event Action? DiagnosticsRequested;
    internal event Action? UnpairRequested;

    internal RunnerForm()
    {
        Text = "Amniora Runner"; ClientSize = new Size(540, 640); MinimumSize = new Size(500, 580);
        BackColor = Color.FromArgb(4, 17, 30); ForeColor = Color.White; Font = new Font("Segoe UI", 10);
        StartPosition = FormStartPosition.CenterScreen;

        var root = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false,
            AutoScroll = true, Padding = new Padding(28) };
        Controls.Add(root);
        root.Controls.Add(TextLabel("AMNIORA RUNNER", 18, Color.FromArgb(186, 230, 253), FontStyle.Bold));
        root.Controls.Add(Section("ACCOUNT", "Amniora connection", _account));
        var statusPanel = Section("LOCAL EXECUTION STATUS", "", _status);
        root.Controls.Add(statusPanel);
        root.Controls.Add(Section("CURRENT RUNTIME", "", _runtime));
        root.Controls.Add(Section("ACTIVITY", "", _activity));
        root.Controls.Add(Buttons());

        _tray = new NotifyIcon { Icon = SystemIcons.Application, Text = "Amniora Runner", Visible = true,
            ContextMenuStrip = new ContextMenuStrip() };
        _tray.ContextMenuStrip.Items.Add("Open", null, (_, _) => RestoreWindow());
        _tray.ContextMenuStrip.Items.Add("Quit", null, (_, _) => Quit());
        _tray.DoubleClick += (_, _) => RestoreWindow();
        FormClosing += (_, e) => { if (!_quitting) { e.Cancel = true; Hide(); } };
        Render(RunnerSnapshot.Starting);
    }

    internal void Render(RunnerSnapshot snapshot)
    {
        _account.Text = snapshot.Account; _runtime.Text = snapshot.Runtime; _activity.Text = snapshot.Activity;
        _status.Controls.Clear();
        AddStatus("Runner", snapshot.Runner); AddStatus("Virtual machine", snapshot.VirtualMachine);
        AddStatus("Guest agent", snapshot.GuestAgent); AddStatus("Docker", snapshot.Docker);
    }

    internal void ApplyDiagnostics(RunnerDiagnostics diagnostics, string acknowledgement)
    {
        if (InvokeRequired) { BeginInvoke(() => ApplyDiagnostics(diagnostics, acknowledgement)); return; }
        _account.Text = diagnostics.Account; _runtime.Text = diagnostics.Runtime; _activity.Text = acknowledgement;
        _status.Controls.Clear();
        AddStatus("Runner", diagnostics.Connected ? Health.Ready : Health.Warning);
        AddStatus("Virtual machine", Health.Unknown, diagnostics.VirtualMachine);
        AddStatus("Guest agent", Health.Unknown, diagnostics.GuestAgent);
        AddStatus("Docker", Health.Unknown, diagnostics.Docker);
    }

    internal void RestoreWindow()
    {
        if (InvokeRequired) { BeginInvoke(RestoreWindow); return; }
        Show(); WindowState = FormWindowState.Normal; Activate(); BringToFront();
    }

    internal void SetActivity(string value) { if (InvokeRequired) BeginInvoke(() => _activity.Text = value); else _activity.Text = value; }

    internal void QuitForOwnerTest()
    {
        if (InvokeRequired) { BeginInvoke(QuitForOwnerTest); return; }
        Quit();
    }

    private Control Buttons()
    {
        var panel = new FlowLayoutPanel { AutoSize = true, Margin = new Padding(0, 18, 0, 0) };
        panel.Controls.Add(ActionButton("Open Amniora", (_, _) => Process.Start(new ProcessStartInfo("https://portfolio.example.test") { UseShellExecute = true })));
        panel.Controls.Add(ActionButton("Diagnostics", (_, _) => DiagnosticsRequested?.Invoke()));
        panel.Controls.Add(ActionButton("Settings", (_, _) => MessageBox.Show(this, "Settings are intentionally limited during W1.", "Amniora Runner")));
        panel.Controls.Add(ActionButton("Unpair", (_, _) => UnpairRequested?.Invoke()));
        panel.Controls.Add(ActionButton("Quit", (_, _) => Quit()));
        return panel;
    }

    private void AddStatus(string name, Health health, string? detail = null)
    {
        var color = health switch { Health.Ready => Color.FromArgb(74, 222, 128), Health.Warning => Color.FromArgb(251, 191, 36),
            Health.Error => Color.FromArgb(248, 113, 113), _ => Color.FromArgb(148, 163, 184) };
        _status.Controls.Add(TextLabel($"●  {name}", 10, color));
        _status.Controls.Add(TextLabel(detail ?? health.ToString(), 10, color));
    }

    private static Control Section(string title, string subtitle, Control body)
    {
        var panel = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true,
            Width = 465, Padding = new Padding(16), Margin = new Padding(0, 18, 0, 0), BackColor = Color.FromArgb(7, 30, 48) };
        panel.Controls.Add(TextLabel(title, 9, Color.FromArgb(125, 211, 252), FontStyle.Bold));
        if (subtitle.Length > 0) panel.Controls.Add(TextLabel(subtitle, 10, Color.FromArgb(203, 213, 225)));
        panel.Controls.Add(body); return panel;
    }

    private static Label TextLabel(string text, float size, Color? color = null, FontStyle style = FontStyle.Regular) =>
        new() { Text = text, AutoSize = true, ForeColor = color ?? Color.White, Font = new Font("Segoe UI", size, style), Margin = new Padding(0, 4, 0, 4) };
    private static Button ActionButton(string text, EventHandler click) { var button = new Button { Text = text, AutoSize = true,
        FlatStyle = FlatStyle.Flat, ForeColor = Color.FromArgb(186, 230, 253), BackColor = Color.FromArgb(11, 32, 51), Margin = new Padding(0, 0, 8, 8) };
        button.FlatAppearance.BorderColor = Color.FromArgb(45, 84, 110); button.Click += click; return button; }
    private void Quit() { _quitting = true; _tray.Visible = false; Application.Exit(); }
    protected override void Dispose(bool disposing) { if (disposing) _tray.Dispose(); base.Dispose(disposing); }
}
