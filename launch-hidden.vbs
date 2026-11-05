Option Explicit

' Nuvio silent launcher.
' Runs start.cmd with a hidden console so Windows 11 does not create a
' Windows Terminal window at login or when the desktop shortcut is opened.
Dim fso, shell, root, command, extra, index
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

root = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = root
shell.Environment("PROCESS")("NUVIO_HIDDEN") = "1"

extra = ""
For index = 0 To WScript.Arguments.Count - 1
  extra = extra & " " & WScript.Arguments(index)
Next

command = """" & root & "\start.cmd""" & extra
shell.Run command, 0, False
