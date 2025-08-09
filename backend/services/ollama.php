<?php
// ollama.php
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: *");

$input = json_decode(file_get_contents("php://input"), true);
$model = isset($input['model']) ? $input['model'] : "gemma:2b";
$prompt = isset($input['prompt']) ? $input['prompt'] : "Hello";

$data = [
    "model" => $model,
    "prompt" => $prompt,
    "stream" => false
];

$ch = curl_init("http://127.0.0.1:11434/api/generate");
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json"]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));

$response = curl_exec($ch);
if ($response === false) {
    echo json_encode(["error" => "Error talking to Ollama: " . curl_error($ch)]);
} else {
    echo $response;
}
curl_close($ch);
