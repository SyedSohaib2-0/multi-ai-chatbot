<?php
header("Content-Type: application/json");

$request = json_decode(file_get_contents("php://input"), true);
$userMessage = $request["message"] ?? "";

require_once "config.php";

$responseText = "";

// Pick AI provider
switch ($AI_PROVIDER) {
    case "ollama":
        require_once "services/ollama.php";
        $responseText = ollama_reply($userMessage);
        break;
    case "gemini":
        require_once "services/gemini.php";
        $responseText = gemini_reply($userMessage);
        break;
    case "openai":
        require_once "services/openai.php";
        $responseText = openai_reply($userMessage);
        break;
    default:
        $responseText = "No AI provider configured.";
}

echo json_encode(["reply" => $responseText]);
?>
