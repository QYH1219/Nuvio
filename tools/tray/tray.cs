// Nuvio tray helper.
//
// The injector runs detached with no window, so Windows never gives it a
// taskbar button. That is correct for a background process but leaves users
// with no visible proof it is running. This helper puts one icon in the
// notification area with the three actions people ask for: reload, focus
// Codex, quit.
//
// It talks to Shell_NotifyIcon directly instead of pulling in WinForms; a
// message loop plus one popup menu costs ~10MB less than a hidden form and
// starts instantly. Compiled on demand with the in-box csc.exe, cached in
// .nuvio/, so the repository never carries a binary.

using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32;

internal static class Program
{
    private const int WM_APP = 0x8000;
    private const int WM_TRAYICON = WM_APP + 1;
    private const int WM_LBUTTONDBLCLK = 0x0203;
    private const int WM_RBUTTONUP = 0x0205;
    private const int WM_LBUTTONUP = 0x0202;
    private const int WM_TIMER = 0x0113;
    private const int WM_NULL = 0x0000;

    private const uint NIF_MESSAGE = 0x00000001;
    private const uint NIF_ICON = 0x00000002;
    private const uint NIF_TIP = 0x00000004;
    private const uint NIM_ADD = 0x00000000;
    private const uint NIM_DELETE = 0x00000002;

    private const uint MF_STRING = 0x00000000;
    private const uint MF_SEPARATOR = 0x00000800;
    private const uint MF_GRAYED = 0x00000001;
    private const uint TPM_RIGHTBUTTON = 0x0002;
    private const uint TPM_RETURNCMD = 0x0100;

    private const int IDM_RELOAD = 1;
    private const int IDM_FOCUS = 2;
    private const int IDM_LOG = 3;
    private const int IDM_QUIT = 4;

    private const uint IMAGE_ICON = 1;
    private const uint LR_LOADFROMFILE = 0x00000010;
    private const int SM_CXSMICON = 49;
    private const int SM_CYSMICON = 50;

    private static string statePath = "";
    private static string iconPath = "";
    private static string rootPath = "";
    private static string selfPath = "";
    private static string version = "";
    private static IntPtr window;
    private static IntPtr icon;
    private static WndProc proc;
    private static uint taskbarCreated;
    private static string className = "NuvioTrayWindow";
    private static int missingStateTicks;
    private static int deadPidTicks;

    // Environment.ProcessPath is .NET 6+; the in-box csc targets .NET Framework.
    private static string SelfPath
    {
        get
        {
            if (selfPath.Length == 0)
            {
                try
                {
                    selfPath = Process.GetCurrentProcess().MainModule.FileName;
                }
                catch
                {
                    selfPath = "";
                }
            }
            return selfPath;
        }
    }

    private static void Trace(string line)
    {
        try
        {
            if (rootPath.Length == 0)
            {
                return;
            }
            var folder = Path.Combine(rootPath, ".nuvio");
            Directory.CreateDirectory(folder);
            File.AppendAllText(
                Path.Combine(folder, "tray.log"),
                DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + line + Environment.NewLine
            );
        }
        catch
        {
            // Diagnostics must never break the tray.
        }
    }

    [STAThread]
    private static int Main(string[] args)
    {
        for (var index = 0; index < args.Length; index++)
        {
            switch (args[index])
            {
                case "--state":
                    statePath = args[++index];
                    break;
                case "--icon":
                    iconPath = args[++index];
                    break;
                case "--root":
                    rootPath = args[++index];
                    break;
                case "--version":
                    version = args[++index];
                    break;
            }
        }

        if (statePath.Length == 0 || iconPath.Length == 0)
        {
            return 2;
        }

        // A relaunch replaces the injector and therefore the tray at nearly the
        // same moment. The old helper needs a beat to release its mutex; exiting
        // instantly on "not created" is what left the user with no icon at all.
        Mutex mutex = null;
        var created = false;
        for (var attempt = 0; attempt < 8; attempt++)
        {
            mutex = new Mutex(true, @"Local\NuvioTrayIcon", out created);
            if (created) break;
            mutex.Dispose();
            mutex = null;
            Thread.Sleep(500);
        }
        if (mutex == null)
        {
            Trace("another tray is already running");
            return 0;
        }
        using (mutex)
        {
            return Run();
        }
    }

    private static int Run()
    {
        var instance = GetModuleHandle(null);
        proc = WindowProc;

        var wc = new WNDCLASSW
        {
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(proc),
            hInstance = instance,
            lpszClassName = className,
        };
        if (RegisterClassW(ref wc) == 0 && Marshal.GetLastWin32Error() != 1410 /* class exists */)
        {
            Trace("RegisterClassW failed: " + Marshal.GetLastWin32Error());
            return 3;
        }

        // A normal but never-shown top-level window. Message-only windows are
        // not reliable hosts for Shell_NotifyIcon callbacks.
        window = CreateWindowExW(
            0,
            className,
            "Nuvio",
            0,
            0,
            0,
            0,
            0,
            IntPtr.Zero,
            IntPtr.Zero,
            instance,
            IntPtr.Zero
        );
        if (window == IntPtr.Zero)
        {
            Trace("CreateWindowExW failed: " + Marshal.GetLastWin32Error());
            return 4;
        }

        // Explorer restart broadcasts this; without it the icon would vanish
        // until the next Nuvio start.
        taskbarCreated = RegisterWindowMessageW("TaskbarCreated");

        icon = LoadImageW(
            IntPtr.Zero,
            iconPath,
            IMAGE_ICON,
            GetSystemMetrics(SM_CXSMICON),
            GetSystemMetrics(SM_CYSMICON),
            LR_LOADFROMFILE
        );

        if (!AddIcon())
        {
            Trace("Shell_NotifyIconW add failed: " + Marshal.GetLastWin32Error());
            return 5;
        }

        PromoteIcon();
        Heartbeat();
        Trace("tray started pid=" + Process.GetCurrentProcess().Id + " version=" + version);
        SetTimer(window, (UIntPtr)1, 2000, IntPtr.Zero);

        MSG message;
        while (GetMessageW(out message, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref message);
            DispatchMessageW(ref message);
        }

        RemoveIcon();
        return 0;
    }

    private static bool AddIcon()
    {
        var data = NewIconData();
        data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
        data.uCallbackMessage = WM_TRAYICON;
        data.hIcon = icon;
        data.szTip = "Nuvio · 动态背景运行中";
        if (!Shell_NotifyIconW(NIM_ADD, ref data))
        {
            return false;
        }
        return true;
    }

    private static void RemoveIcon()
    {
        var data = NewIconData();
        Shell_NotifyIconW(NIM_DELETE, ref data);
    }

    private static NOTIFYICONDATAW NewIconData()
    {
        return new NOTIFYICONDATAW
        {
            cbSize = Marshal.SizeOf(typeof(NOTIFYICONDATAW)),
            hWnd = window,
            uID = 1,
        };
    }

    private static IntPtr WindowProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam)
    {
        if (taskbarCreated != 0 && message == taskbarCreated)
        {
            AddIcon();
            return IntPtr.Zero;
        }
        switch (message)
        {
            case WM_TRAYICON:
            {
                var mouse = (int)(lParam.ToInt64() & 0xFFFF);
                if (mouse == WM_RBUTTONUP)
                {
                    ShowMenu();
                    return IntPtr.Zero;
                }
                if (mouse == WM_LBUTTONDBLCLK)
                {
                    Post("/reload", "{}");
                    return IntPtr.Zero;
                }
                return IntPtr.Zero;
            }
            case WM_TIMER:
                Watch();
                return IntPtr.Zero;
        }
        return DefWindowProcW(hwnd, message, wParam, lParam);
    }

    private static void ShowMenu()
    {
        var menu = CreatePopupMenu();
        if (menu == IntPtr.Zero)
        {
            return;
        }

        AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, "Nuvio · 动态背景");
        AppendMenuW(menu, MF_SEPARATOR, 0, null);
        AppendMenuW(menu, MF_STRING, IDM_RELOAD, "重新加载背景");
        AppendMenuW(menu, MF_STRING, IDM_FOCUS, "切换到 Codex");
        AppendMenuW(menu, MF_STRING, IDM_LOG, "打开日志");
        AppendMenuW(menu, MF_SEPARATOR, 0, null);
        AppendMenuW(menu, MF_STRING, IDM_QUIT, "恢复并退出（保留壁纸设置）");

        POINT point;
        GetCursorPos(out point);
        // Without this the menu stays on screen after the user clicks away.
        SetForegroundWindow(window);
        var command = TrackPopupMenu(
            menu,
            TPM_RIGHTBUTTON | TPM_RETURNCMD,
            point.X,
            point.Y,
            0,
            window,
            IntPtr.Zero
        );
        PostMessageW(window, WM_NULL, IntPtr.Zero, IntPtr.Zero);
        DestroyMenu(menu);

        switch (command)
        {
            case IDM_RELOAD:
                Post("/reload", "{}");
                break;
            case IDM_FOCUS:
                FocusCodex();
                break;
            case IDM_LOG:
                OpenLog();
                break;
            case IDM_QUIT:
                Quit();
                break;
        }
    }

    private static void Watch()
    {
        Heartbeat();

        if (!File.Exists(statePath))
        {
            // A relaunch deletes and rewrites the state file within a few
            // seconds. Only treat it as gone after three ticks (6s), otherwise
            // the icon disappears exactly when the injector is being replaced.
            missingStateTicks++;
            if (missingStateTicks >= 3)
            {
                // /restore deletes the state file; the injector is gone and a
                // tray icon that outlives it would be a lie.
                Exit("state file removed");
            }
            return;
        }
        missingStateTicks = 0;

        try
        {
            var text = File.ReadAllText(statePath);
            var match = Regex.Match(text, "\"pid\"\\s*:\\s*(\\d+)");
            if (!match.Success)
            {
                return;
            }
            var pid = int.Parse(match.Groups[1].Value);
            var process = Process.GetProcessById(pid);
            if (process.HasExited)
            {
                deadPidTicks++;
                if (deadPidTicks >= 3)
                {
                    Exit("injector pid " + pid + " is gone");
                }
            }
            else
            {
                deadPidTicks = 0;
            }
        }
        catch (ArgumentException)
        {
            deadPidTicks++;
            if (deadPidTicks >= 3)
            {
                Exit("injector pid is gone");
            }
        }
        catch (IOException)
        {
            // Half-written state file during startup; try again next tick.
        }
    }

    private static void Quit()
    {
        Post("/restore", "{\"keepConfig\":true}");
        Exit("user quit");
    }

    private static void Exit(string reason)
    {
        Trace("exit: " + reason);
        try
        {
            var beat = Path.Combine(rootPath, ".nuvio", "tray.heartbeat");
            File.Delete(beat);
        }
        catch
        {
            // Best effort; a stale heartbeat only costs one duplicate spawn.
        }
        RemoveIcon();
        DestroyWindow(window);
        PostQuitMessage(0);
    }

    /// <summary>
    /// The injector watches this file and restarts the tray if it goes stale.
    /// Without a supervisor one mutex race is enough to lose the icon for the
    /// rest of the session.
    /// </summary>
    private static void Heartbeat()
    {
        try
        {
            if (rootPath.Length == 0)
            {
                return;
            }
            var folder = Path.Combine(rootPath, ".nuvio");
            Directory.CreateDirectory(folder);
            File.WriteAllText(
                Path.Combine(folder, "tray.heartbeat"),
                Process.GetCurrentProcess().Id + " " + version + " " +
                    DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            );
        }
        catch
        {
            // Diagnostics must never break the icon.
        }
    }

    private static bool Post(string path, string json)
    {
        try
        {
            var text = File.ReadAllText(statePath);
            var port = Regex.Match(text, "\"controlPort\"\\s*:\\s*(\\d+)");
            var token = Regex.Match(text, "\"token\"\\s*:\\s*\"([^\"]+)\"");
            if (!port.Success || !token.Success)
            {
                return false;
            }

            var request = (HttpWebRequest)
                WebRequest.Create("http://127.0.0.1:" + port.Groups[1].Value + path);
            request.Method = "POST";
            request.ContentType = "application/json";
            request.Timeout = 5000;
            request.ReadWriteTimeout = 5000;
            request.Headers["x-cxd-token"] = token.Groups[1].Value;

            var body = Encoding.UTF8.GetBytes(json);
            request.ContentLength = body.Length;
            using (var stream = request.GetRequestStream())
            {
                stream.Write(body, 0, body.Length);
            }
            using (var response = (HttpWebResponse)request.GetResponse())
            {
                return (int)response.StatusCode == 200;
            }
        }
        catch
        {
            return false;
        }
    }

    private static void FocusCodex()
    {
        var target = IntPtr.Zero;
        EnumWindows(
            delegate(IntPtr handle, IntPtr param)
            {
                if (!IsWindowVisible(handle) || GetWindowTextLengthW(handle) == 0)
                {
                    return true;
                }

                uint pid;
                GetWindowThreadProcessId(handle, out pid);
                try
                {
                    var name = Process.GetProcessById((int)pid).ProcessName;
                    if (
                        string.Equals(name, "ChatGPT", StringComparison.OrdinalIgnoreCase)
                        || string.Equals(name, "Codex", StringComparison.OrdinalIgnoreCase)
                    )
                    {
                        target = handle;
                        return false;
                    }
                }
                catch
                {
                    // process died between enumeration and lookup
                }
                return true;
            },
            IntPtr.Zero
        );

        if (target == IntPtr.Zero)
        {
            return;
        }

        ShowWindow(target, 9 /* SW_RESTORE */);
        SetForegroundWindow(target);
    }

    private static void OpenLog()
    {
        try
        {
            var log = Path.Combine(rootPath, ".nuvio", "injector.log");
            if (File.Exists(log))
            {
                Process.Start(new ProcessStartInfo(log) { UseShellExecute = true });
                return;
            }
            var folder = Path.Combine(rootPath, ".nuvio");
            if (Directory.Exists(folder))
            {
                Process.Start("explorer.exe", "\"" + folder + "\"");
            }
        }
        catch
        {
            // opening a log is a convenience, never a failure
        }
    }

    /// <summary>
    /// Windows 11 parks a new tray icon in the overflow flyout until the user
    /// drags it out. Flip the per-app flag once, and only when the user has
    /// never set it themselves.
    /// </summary>
    private static void PromoteIcon()
    {
        try
        {
            using (var root = Registry.CurrentUser.OpenSubKey(@"Control Panel\NotifyIconSettings", true))
            {
                if (root == null)
                {
                    return;
                }
                foreach (var name in root.GetSubKeyNames())
                {
                    using (var entry = root.OpenSubKey(name, true))
                    {
                        if (entry == null)
                        {
                            continue;
                        }
                        var exe = entry.GetValue("ExecutablePath") as string;
                        if (exe == null || !string.Equals(exe, SelfPath, StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }
                        if (entry.GetValue("IsPromoted") == null)
                        {
                            entry.SetValue("IsPromoted", 1, RegistryValueKind.DWord);
                        }
                        return;
                    }
                }
            }
        }
        catch
        {
            // Hiding in the overflow is cosmetic; never fail the tray over it.
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATAW
    {
        public int cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;
        public uint dwState;
        public uint dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string szInfo;
        public uint uTimeoutOrVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string szInfoTitle;
        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WNDCLASSW
    {
        public uint style;
        public IntPtr lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string lpszMenuName;
        public string lpszClassName;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public POINT pt;
    }

    private delegate IntPtr WndProc(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr param);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern ushort RegisterClassW(ref WNDCLASSW windowClass);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowExW(
        uint exStyle,
        string className,
        string windowName,
        uint style,
        int x,
        int y,
        int width,
        int height,
        IntPtr parent,
        IntPtr menu,
        IntPtr instance,
        IntPtr param
    );

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr DefWindowProcW(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool DestroyWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern int GetMessageW(out MSG message, IntPtr hwnd, uint min, uint max);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage(ref MSG message);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessageW(ref MSG message);

    [DllImport("user32.dll")]
    private static extern void PostQuitMessage(int code);

    [DllImport("user32.dll")]
    private static extern bool PostMessageW(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern UIntPtr SetTimer(IntPtr hwnd, UIntPtr id, uint interval, IntPtr callback);

    [DllImport("user32.dll")]
    private static extern bool KillTimer(IntPtr hwnd, UIntPtr id);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadImageW(
        IntPtr instance,
        string name,
        uint type,
        int width,
        int height,
        uint load
    );

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int index);

    [DllImport("user32.dll")]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool AppendMenuW(IntPtr menu, uint flags, int id, string text);

    [DllImport("user32.dll")]
    private static extern int TrackPopupMenu(
        IntPtr menu,
        uint flags,
        int x,
        int y,
        int reserved,
        IntPtr hwnd,
        IntPtr rect
    );

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(IntPtr menu);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT point);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hwnd, int command);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr param);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLengthW(IntPtr hwnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessageW(string name);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string name);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Shell_NotifyIconW(uint message, ref NOTIFYICONDATAW data);
}
